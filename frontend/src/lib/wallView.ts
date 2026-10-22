/**
 * 작가 홈페이지의 작품 보기 — [사진 | 벽에 걸어 보기] (2026-10-22, CLAUDE.md 규칙 74). 판단·저장·보관만 여기(순수, 테스트 대상).
 *
 * 미미오(mimio.life) 작가 페이지의 [See More] 창은 작품을 회색 벽에 그림자와 함께 걸어 보여 준다. 우리 라이트박스는
 * 검은 바탕에 사진뿐이었다. 우리에겐 그 일을 더 잘하는 ArtLook 엔진이 있어서, 그 엔진으로 차콜 벽에 오크 플로터·넓은 매트로 걸어 보여 준다.
 *
 * 엔진은 번들 밖 정적 페이지(`public/artlook/`)라 **화면 밖 iframe**(`/artlook/index.html?view=1`)으로 띄우고
 * postMessage 로 그림을 주고받는다(`hooks/useWallView.ts`). 그 안에서는 화면(ui.js) 대신 `view.js` 가 그리기만 한다.
 *
 * ⚠️ 같은 출처 iframe 은 이 페이지와 **같은 스레드**다 — 엔진이 그리는 동안(헤드리스 0.2~0.8초) 이 화면도 멈춘다.
 *    그래서 한 번에 하나만, 지금 보는 작품부터 그린다(`wallJobs`). 초안은 합성 배율 1(빨리), 완성은 **2 — ArtLook 탭 저장과 같은 화질**
 *    (`wallRenderScale`). 속도 때문에 완성을 1, 초안을 0.6 으로 낮췄더니 "아트룩보다 퀄리티가 개쓰레기"가 됐다(2026-10-23) —
 *    액자·매트는 모서리가 세밀해서 배율 차이가 드러난다(scratchpad/wall-view/quality.mjs).
 */
import { thumbUrl } from '@/components/shared/Thumb';

export type ViewerMode = 'photo' | 'wall';
/** draft = t800 썸네일로 빨리 한 장 · full = 원본으로 다시 그린 것 */
export type WallQuality = 'draft' | 'full';

/** 엔진을 '그리기 전용'으로 띄우는 주소 — `?view=1` 이면 index.html 이 ui.js 대신 view.js 에 맡긴다 */
export const WALL_VIEW_URL = '/artlook/index.html?view=1';

/* ───── 마지막 보기 방식 — 이 탭에서만 기억한다(벽을 골랐으면 다음 작품·다음에 열 때도 벽) ───── */

const MODE_KEY = 'artlink-artwork-view';

export function readViewerMode(): ViewerMode {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'wall' ? 'wall' : 'photo';
  } catch {
    return 'photo';   // 저장소가 막힌 환경 — 늘 사진부터
  }
}

export function saveViewerMode(mode: ViewerMode): void {
  try {
    if (mode === 'wall') sessionStorage.setItem(MODE_KEY, 'wall');
    else sessionStorage.removeItem(MODE_KEY);
  } catch { /* 이번 화면에서만 기억한다 */ }
}

/**
 * 이 브라우저가 그릴 수 있을 것 같은가 — 엔진의 장면 합성은 WebGL2 가 있어야 한다(규칙 36).
 * 정말 되는지는 iframe 이 뜬 뒤에 안다(`artlook:view-unsupported`) — 그때 토글을 감춘다.
 */
export function wallViewLikelySupported(): boolean {
  try {
    return typeof window !== 'undefined' && typeof document !== 'undefined' && 'WebGL2RenderingContext' in window;
  } catch {
    return false;
  }
}

/** 이웃 작품을 미리 그려도 되는가 — 데이터 절약 모드·느린 회선이면 지금 보는 것만 */
export function wallPrefetchAllowed(): boolean {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return false;
    if (c?.effectiveType && /2g$|^3g$/.test(c.effectiveType)) return false;
    return true;
  } catch {
    return true;
  }
}

/** 그릴 때 보낼 작품 사진 — 초안은 t800(작고 빠르다), 완성은 원본(벽 위 작품은 출력 긴 변의 70% 라 800px 로는 조금 무르다) */
export function wallSourceUrl(url: string, quality: WallQuality): string {
  return quality === 'draft' ? thumbUrl(url, 'grid') : url;
}

/**
 * 합성 배율 — 초안 1 · 완성 2(엔진 기본 = ArtLook 탭 저장과 같은 화질).
 * ⚠️ 완성을 1 로 낮추지 말 것 — 액자·매트의 모서리·결이 뭉개져 ArtLook 탭에서 본 것과 다른 그림이 된다.
 * ⚠️ 초안을 1 보다 작게 그리지 말 것 — 0.6 으로 해 봤더니(출력보다 작게 그려 키움) 첫 그림이 눈에 띄게 뭉개졌다.
 * 작품이 앉는 자리는 배율과 무관하게 같다(엔진이 확대 한도에 배율을 곱해 넘긴다 — 규칙 42) — 초안 → 완성에서 움직이지 않는다.
 */
export function wallRenderScale(quality: WallQuality): number {
  return quality === 'draft' ? 1 : 2;
}

/* ───── iframe 과 주고받는 말 ───── */

export const WALL_RESULT_MAX = 20 * 1024 * 1024;

export type WallMessage =
  | { type: 'ready' }
  | { type: 'unsupported'; reason: string }
  | { type: 'rendered'; req: number; blob: Blob; ratio: string }
  | { type: 'failed'; req: number; reason: string };

const isReq = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/**
 * iframe 이 보낸 말을 읽는다 — 모양이 틀리면 null.
 * ⚠️ **보낸 쪽은 부르는 쪽이 확인한다**(`e.source === iframe.contentWindow && e.origin === location.origin`, lib/artlook.ts 와 같은 규칙).
 */
export function readWallMessage(data: unknown): WallMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const reason = typeof d.reason === 'string' ? d.reason.slice(0, 80) : '';
  switch (d.type) {
    case 'artlook:view-ready':
      return { type: 'ready' };
    case 'artlook:view-unsupported':
      return { type: 'unsupported', reason };
    case 'artlook:rendered': {
      if (!isReq(d.req)) return null;
      if (typeof Blob === 'undefined' || !(d.blob instanceof Blob) || d.blob.type !== 'image/jpeg') return null;
      if (d.blob.size <= 0 || d.blob.size > WALL_RESULT_MAX) return null;
      const ratio = typeof d.ratio === 'string' && /^\d{1,2}:\d{1,2}$/.test(d.ratio) ? d.ratio : '';
      return { type: 'rendered', req: d.req, blob: d.blob, ratio };
    }
    case 'artlook:render-failed':
      return isReq(d.req) ? { type: 'failed', req: d.req, reason } : null;
    default:
      return null;
  }
}

/** iframe 에 보낼 말 — 합성 배율은 초안 1 · 완성 2(`wallRenderScale`) */
export function renderRequest(req: number, blob: Blob, quality: WallQuality): { type: 'artlook:render'; req: number; blob: Blob; ss: number } {
  return { type: 'artlook:render', req, blob, ss: wallRenderScale(quality) };
}

/**
 * 이 브라우저에서는 안 되는 이유인가 — 그렇다면 토글을 감춘다. 나머지('scene' 벽 사진을 못 받음·시간 초과)는 다시 해 볼 수 있다.
 */
export function isUnsupportedReason(reason: string): boolean {
  return reason === 'webgl' || reason === 'frame';
}

/** WebGL 을 잃었다(휴대폰 메모리 등) — 못 그린 게 아니라 엔진을 새로 띄우면 된다. 그린 그림을 보내지 않고 이 이유로 접는다(view.js) */
export const GL_LOST = 'gl-lost';

/* ───── 그릴 순서 ───── */

export interface WallJob { index: number; quality: WallQuality }

/**
 * 다음에 그릴 것들 — 지금 작품(초안 → 원본) → 다음·이전 작품(초안, `prefetch` 일 때만).
 * 이미 있는 것·못 그린 것은 뺀다. 원본으로 다시 그린 게 있으면 초안은 필요 없다.
 */
export function wallJobs(o: {
  index: number;
  total: number;
  has: (index: number) => WallQuality | null;
  failed: (index: number) => boolean;
  prefetch: boolean;
}): WallJob[] {
  const { index: i, total: n } = o;
  const out: WallJob[] = [];
  if (n <= 0 || i < 0 || i >= n) return out;
  if (!o.failed(i)) {
    const q = o.has(i);
    if (!q) out.push({ index: i, quality: 'draft' });
    if (q !== 'full') out.push({ index: i, quality: 'full' });
  }
  if (o.prefetch && n > 1) {
    for (const j of [(i + 1) % n, (i - 1 + n) % n]) {
      if (j === i || out.some((x) => x.index === j)) continue;
      if (!o.failed(j) && !o.has(j)) out.push({ index: j, quality: 'draft' });
    }
  }
  return out;
}

/* ───── 그린 그림 보관 ───── */

/**
 * 작품 주소당 가장 좋은 한 장(objectURL). 오래 안 본 것부터 버리고 **버릴 때 objectURL 을 놓는다**.
 * 원본으로 다시 그린 게 오면 초안을 바꿔 끼운다(반대로 늦게 온 초안은 버린다).
 */
export class WallCache {
  private map = new Map<string, { quality: WallQuality; src: string }>();
  private max: number;
  private revoke: (src: string) => void;

  constructor(max = 12, revoke: (src: string) => void = (src) => URL.revokeObjectURL(src)) {
    this.max = max;
    this.revoke = revoke;
  }

  /** 읽기만 — 순서를 바꾸지 않는다(그리는 중에 불러도 된다) */
  peek(key: string): { quality: WallQuality; src: string } | null {
    return this.map.get(key) ?? null;
  }

  /** 지금 보고 있다 — 맨 뒤(가장 최근)로 */
  touch(key: string): void {
    const v = this.map.get(key);
    if (!v) return;
    this.map.delete(key);
    this.map.set(key, v);
  }

  /** @returns 들어갔는가(더 좋은 게 이미 있어서 버렸으면 false — 그 src 도 놓았다) */
  put(key: string, quality: WallQuality, src: string): boolean {
    const cur = this.map.get(key);
    if (cur && cur.quality === 'full' && quality === 'draft') {
      this.revoke(src);
      return false;
    }
    if (cur && cur.src !== src) this.revoke(cur.src);
    this.map.delete(key);
    this.map.set(key, { quality, src });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      const v = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.revoke(v.src);
    }
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.forEach((v) => this.revoke(v.src));
    this.map.clear();
  }
}
