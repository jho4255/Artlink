/**
 * 이미지 획득 공용 모듈 — 운영페이지의 ZIP/PDF 생성이 공유한다.
 *
 * ## 배경 (2026-08 성능 사고)
 * 운영페이지의 "전체 작품원본(ZIP)" / "전체 PDF(ZIP)"가 몇 분씩 걸리거나 실패했다. 원인:
 *  1) 모든 이미지가 백엔드 `image-proxy`를 경유 → Render 인스턴스가 전 이미지를 중계하며 병목.
 *     실제 서버 로그에 10초 타임아웃 500이 다수(`AbortSignal.timeout(10000)`).
 *  2) ZIP이 완전 순차 처리 → 지연이 그대로 곱해짐.
 *  3) PDF가 같은 이미지를 다시 받음(ZIP과 캐시 공유 없음).
 *  4) 실패해도 재시도·안내가 없고 진행률이 없어 "멈춘 것처럼" 보임.
 *
 * ## 해결
 *  - R2 버킷에 CORS를 열어 **브라우저가 R2에서 직접** 받는다(프록시 우회). 실패 시에만 프록시 폴백.
 *  - 동시 실행 제한 병렬 + 진행률 콜백.
 *  - URL 단위 캐시로 ZIP/PDF가 같은 이미지를 한 번만 받는다.
 *  - 각 이미지에 타임아웃을 걸어 "영원히 대기"가 생기지 않게 한다.
 */

/**
 * 타임아웃은 **총 시간이 아니라 "데이터가 흐르는가"** 로 판정한다.
 *
 * 총 시간으로 자르면 '죽은 요청'과 '느린 요청'을 구분하지 못한다. 작품 이미지가 평균 1MB라
 * 1Mbps 회선에서는 정상 다운로드도 8초가 걸린다 — 총 시간 8초로 자르면 멀쩡한 다운로드가 끊긴다.
 * 게다가 이어받기가 없어 재시도는 0부터 다시 받으므로, 느린 회선에서는 짧은 타임아웃+재시도가 순손해다.
 *
 *  - 첫 응답(헤더)까지 10초  : 서버가 아예 응답하지 않으면 빨리 포기
 *  - 이후 무응답 15초        : 한 바이트도 안 오면 죽은 연결로 판정 (느리지만 흐르면 계속 진행)
 *  - 이미지 1장 총 예산 90초 : 극단적 저속(초당 몇 KB)에 대한 안전망
 */
const CONNECT_TIMEOUT_MS = 10_000;
const STALL_TIMEOUT_MS = 15_000;
const PER_IMAGE_BUDGET_MS = 90_000;
/** 동시 실행 수 — 브라우저의 호스트당 연결 한계(약 6)를 넘지 않게 */
export const IMAGE_CONCURRENCY = 5;

export interface FetchedImage {
  blob: Blob;
  /** 실제 MIME (image/jpeg 등) */
  type: string;
  /** 실제 타입에 맞는 확장자 (jpg/png/webp/gif/avif) */
  ext: string;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** 확장자 판정 — content-type 우선, 없으면 URL 꼬리, 그래도 없으면 jpg */
export function extOf(type: string, url: string): string {
  const byType = EXT_BY_TYPE[type.split(';')[0].trim().toLowerCase()];
  if (byType) return byType;
  const m = /\.([a-z0-9]{3,4})(?:\?|$)/i.exec(url);
  const byUrl = m?.[1]?.toLowerCase();
  return byUrl && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(byUrl)
    ? (byUrl === 'jpeg' ? 'jpg' : byUrl)
    : 'jpg';
}

/** 동일출처 프록시 경로 (R2 직접 요청이 실패했을 때의 폴백) */
export function proxyUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/upload/image-proxy?url=${encodeURIComponent(url)}` : url;
}

/** 실패 사유 — 재시도 가치가 있는지 판단하는 데 쓴다 */
type FailKind =
  | 'retryable'  // 연결 오류·5xx·429 → 같은 경로로 한 번 더 해볼 가치가 있다
  | 'fatal'      // 404/403·비이미지 → 다시 해도 같다
  | 'slow';      // 연결/무응답/예산 초과 → 회선 문제라 재시도해도 같다

type AttemptResult = { ok: FetchedImage } | { fail: FailKind };

/** 본문을 스트림으로 읽으며 **청크가 올 때마다 무응답 타이머를 리셋**한다(느린 다운로드는 살려둔다) */
async function readBodyWithStall(res: Response, ctrl: AbortController, deadline: number): Promise<Blob> {
  // 테스트 스텁 등 body가 없으면 통째로 읽는다
  if (!res.body || typeof res.body.getReader !== 'function') return await res.blob();

  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const left = Math.min(STALL_TIMEOUT_MS, Math.max(deadline - Date.now(), 0));
    timer = setTimeout(() => ctrl.abort(), left);
  };
  arm();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value as BlobPart);
      arm(); // 데이터가 흐르는 한 계속 기다린다
    }
  } finally {
    clearTimeout(timer);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || '' });
}

async function attempt(target: string, url: string, deadline: number): Promise<AttemptResult> {
  if (Date.now() >= deadline) return { fail: 'slow' };
  const ctrl = new AbortController();
  // 첫 응답(헤더)까지의 상한. 헤더를 받으면 무응답 타이머로 전환된다.
  const connectTimer = setTimeout(() => ctrl.abort(), Math.min(CONNECT_TIMEOUT_MS, deadline - Date.now()));
  try {
    const res = await fetch(target, { signal: ctrl.signal, credentials: 'omit', cache: 'force-cache' });
    clearTimeout(connectTimer);
    if (!res.ok) {
      return { fail: res.status >= 500 || res.status === 429 ? 'retryable' : 'fatal' };
    }
    const blob = await readBodyWithStall(res, ctrl, deadline);
    if (blob.size === 0) return { fail: 'retryable' };
    const type = blob.type || res.headers.get('content-type') || '';
    if (type && !type.toLowerCase().startsWith('image/')) return { fail: 'fatal' };
    return { ok: { blob, type, ext: extOf(type, url) } };
  } catch {
    // abort(타임아웃/무응답)와 순수 네트워크 오류를 구분한다
    return { fail: ctrl.signal.aborted ? 'slow' : 'retryable' };
  } finally {
    clearTimeout(connectTimer);
  }
}

/**
 * 이미지 1장 받기.
 *  ① R2 직접(CORS) — 실패하면 이유와 무관하게 프록시로 폴백한다.
 *     (CORS 차단과 네트워크 오류는 브라우저에서 구분되지 않으므로 항상 한 번은 폴백한다)
 *  ② 동일출처 프록시 — **retryable(연결오류·5xx)일 때만** 1회 재시도.
 *     느려서 끊긴 경우(slow)는 같은 회선이라 재시도해도 같아 시간만 낭비한다.
 * 예외를 던지지 않고 null을 반환한다(호출부가 실패 목록으로 처리).
 */
async function fetchImageUncached(url: string): Promise<FetchedImage | null> {
  const deadline = Date.now() + PER_IMAGE_BUDGET_MS;
  const isRemote = /^https?:\/\//i.test(url);

  const direct = await attempt(url, url, deadline);
  if ('ok' in direct) return direct.ok;
  if (!isRemote && direct.fail === 'fatal') return null;

  const proxy = isRemote ? proxyUrl(url) : url;
  const first = await attempt(proxy, url, deadline);
  if ('ok' in first) return first.ok;

  if (first.fail === 'retryable') {
    const retry = await attempt(proxy, url, deadline);
    if ('ok' in retry) return retry.ok;
  }
  return null;
}

// URL → 진행 중이거나 완료된 요청. ZIP과 PDF가 같은 이미지를 두 번 받지 않게 공유한다.
const cache = new Map<string, Promise<FetchedImage | null>>();
// blob: URL 캐시 (PDF의 <img src>용). 동일출처라 캔버스 taint가 없다.
const objectUrls = new Map<string, string>();

export function fetchImage(url: string): Promise<FetchedImage | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = fetchImageUncached(url);
  cache.set(url, p);
  return p;
}

/** PDF HTML의 <img src>에 쓸 주소. 캐시에 받아둔 게 있으면 blob: URL, 없으면 프록시 주소. */
export function imageSrc(url: string): string {
  return objectUrls.get(url) ?? proxyUrl(url);
}

/**
 * PDF 생성 전 호출 — 이미지들을 미리 받아 blob: URL을 만들어 둔다(이후 imageSrc가 캐시 히트).
 * **받지 못한 URL 목록을 반환**한다 — 예전엔 실패를 삼켜서 PDF에 이미지가 빈 채로 나가도
 * 사용자가 알 수 없었다(2026-08 지적).
 */
export async function prefetchImages(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const targets = Array.from(new Set(urls.filter(Boolean)));
  const results = await mapLimit(targets, IMAGE_CONCURRENCY, async (u) => {
    if (objectUrls.has(u)) return true;
    const img = await fetchImage(u);
    if (img && !objectUrls.has(u)) objectUrls.set(u, URL.createObjectURL(img.blob));
    return !!img;
  }, onProgress);
  return targets.filter((_, i) => !results[i]);
}

/** 페이지 이탈/작업 종료 시 blob: URL 해제 (메모리 반환) */
export function releaseImageCache(): void {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls.clear();
  cache.clear();
}

/**
 * 동시 실행 수를 제한한 map. 순차 대비 체감 3~5배 빠르면서
 * 브라우저 연결 한계·서버 부하를 넘기지 않는다. 결과는 입력 순서를 유지한다.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length;
  const out = new Array<R>(total);
  let next = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      out[i] = await fn(items[i], i);
      done += 1;
      onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), total) }, worker));
  return out;
}
