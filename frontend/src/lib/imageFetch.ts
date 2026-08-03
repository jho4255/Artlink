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

/** 이미지 1건 요청 상한 — 서버 프록시(20초)보다 약간 길게 잡아 폴백까지 기회를 준다 */
const PER_IMAGE_TIMEOUT_MS = 25_000;
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

async function fetchOnce(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'force-cache' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 이미지 1장 받기.
 * 경로 우선순위: ① R2 직접(CORS) → ② 동일출처 프록시 → ③ 프록시 1회 재시도.
 * 어떤 경우에도 예외를 던지지 않고 null을 반환한다(호출부가 실패 목록으로 처리).
 */
async function fetchImageUncached(url: string): Promise<FetchedImage | null> {
  const isRemote = /^https?:\/\//i.test(url);
  // 원격이면 직접 → 프록시 → 프록시 재시도, 동일출처면 그대로 2회
  const attempts = isRemote ? [url, proxyUrl(url), proxyUrl(url)] : [url, url];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const res = await fetchOnce(attempts[i], PER_IMAGE_TIMEOUT_MS);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size === 0) continue;
      const type = blob.type || res.headers.get('content-type') || '';
      if (type && !type.toLowerCase().startsWith('image/')) continue;
      return { blob, type, ext: extOf(type, url) };
    } catch {
      // 네트워크/CORS/타임아웃 → 다음 경로로
    }
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

/** PDF 생성 전 호출 — 이미지들을 미리 받아 blob: URL을 만들어 둔다(이후 imageSrc가 캐시 히트) */
export async function prefetchImages(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const targets = Array.from(new Set(urls.filter(Boolean)));
  await mapLimit(targets, IMAGE_CONCURRENCY, async (u) => {
    if (objectUrls.has(u)) return;
    const img = await fetchImage(u);
    if (img && !objectUrls.has(u)) objectUrls.set(u, URL.createObjectURL(img.blob));
  }, onProgress);
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
