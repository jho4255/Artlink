import { thumbUrl } from '@/components/shared/Thumb';
import type { FigureSize, GalleryLayout, PostImageAttrs } from '@/lib/postDoc';

/**
 * 커뮤니티 글 사진 배치 (2026-11-13) — 편집기와 읽는 화면이 **같은 함수**를 쓴다(쓰는 모양 = 보이는 모양).
 *
 * - 모아 놓기: **정렬 줄** — 한 줄의 사진 높이가 같고 폭은 비율만큼(사진을 자르지 않는다 — CLAUDE.md 18 의 취지).
 *   CSS 만으로 된다: 칸마다 `flex-grow = 비율` + `aspect-ratio = 비율`. 여기는 줄 나누기만 정한다.
 * - 사진 주소: 글쓰기로 올린 사진(`large`)은 t800·t1280·원본을 srcset 으로, 옛 사진은 t800 → 원본.
 */

/** n 장을 줄마다 많아야 max 장씩, 줄 길이가 고르게(앞줄이 하나 더) — 7장·3장씩이면 [3,2,2] */
export function balancedRows(n: number, max: number): number[] {
  if (n <= 0) return [];
  const rows = Math.ceil(n / Math.max(1, max));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 모아 놓기의 줄 — 'row'(한 줄에 4장까지) · 'grid'(3장까지, 4장이면 2×2) · 'slide'(줄 없음) */
export function galleryRows<T>(items: T[], layout: GalleryLayout): T[][] {
  if (layout === 'slide') return [items];
  const sizes = balancedRows(items.length, layout === 'grid' ? 3 : 4);
  const out: T[][] = [];
  let i = 0;
  for (const s of sizes) { out.push(items.slice(i, i + s)); i += s; }
  return out;
}

/** 사진 비율(가로/세로) — 모르면 4:3 */
export function imageRatio(a: { width?: number | null; height?: number | null }): number {
  const w = a.width ?? 0, h = a.height ?? 0;
  if (w > 0 && h > 0) return Math.min(4, Math.max(0.25, w / h));
  return 4 / 3;
}

/** 폴더 하나를 끼운 주소(`/uploads/a.jpg` → `/uploads/t1280/a.jpg`) — backend lib/thumb.ts thumbKey 와 같은 규칙 */
export function variantUrl(src: string, dir: string): string {
  return src.replace(/\/([^/?#]+)(\?[^#]*)?(#.*)?$/, `/${dir}/$1$2$3`);
}

export interface ImgSource { src: string; srcSet?: string; fallback: string }

/**
 * 읽는 화면의 사진 주소. `large`(글쓰기로 올린 사진 — t1280 이 있다)면 srcset, 아니면 t800 → 실패하면 원본.
 * ⚠️ 썸네일이 없으면(옛 사진·생성 실패) 화면이 `fallback`(원본)으로 바꾼다 — srcset 후보가 404 여도 글이 깨지지 않게.
 */
export function imageSources(a: PostImageAttrs): ImgSource | null {
  if (!a.src) return null;
  if (a.large && a.width) {
    const w = a.width;
    const cand = new Map<number, string>();
    cand.set(Math.min(800, w), variantUrl(a.src, 't800'));
    if (w > 800) cand.set(Math.min(1280, w), variantUrl(a.src, 't1280'));
    if (w > 1280) cand.set(w, a.src);
    const srcSet = [...cand.entries()].sort((x, y) => x[0] - y[0]).map(([cw, u]) => `${u} ${cw}w`).join(', ');
    return { src: variantUrl(a.src, w > 800 ? 't1280' : 't800'), srcSet, fallback: a.src };
  }
  return { src: thumbUrl(a.src, 'grid'), fallback: a.src };
}

/** 배치별 sizes — 본문 680 · 넓게 1040 · 화면 폭(글 칸 끝까지) */
export function sizesFor(size: FigureSize | undefined, columns = 1): string {
  const per = (px: number) => Math.ceil(px / columns);
  if (size === 'full') return columns > 1 ? `${Math.ceil(100 / columns)}vw` : '100vw';
  if (size === 'wide') return `(min-width: 1100px) ${per(1040)}px, ${Math.ceil(100 / columns)}vw`;
  return `(min-width: 740px) ${per(680)}px, ${Math.ceil(100 / columns)}vw`;
}

/** 동영상 틀 비율 — 모르면 16:9 */
export function videoRatio(width: number | null | undefined, height: number | null | undefined): number {
  return width && height && width > 0 && height > 0 ? width / height : 16 / 9;
}

export function videoFrameStyle(ratio: number): import('react').CSSProperties {
  return { aspectRatio: String(ratio), width: `min(100%, calc(75vh * ${ratio.toFixed(4)}))` };
}

/** 사진 모음 칸 — 폭·높이만 본다 */
export interface LayoutItem { width?: number | null; height?: number | null }

/** 넘겨 보기 틀 비율 — 가장 세로로 긴 사진(폭/높이 최소)에 맞추고 [0.8, 1.91] 로 묶는다(세로 사진 한 장이 틀을 화면보다 키우지 않게) */
export function slideFrameRatio(items: LayoutItem[]): number {
  const ratios = items.map((it) => imageRatio(it)).filter((r) => Number.isFinite(r) && r > 0);
  const tallest = ratios.length ? Math.min(...ratios) : 4 / 3;
  return Math.min(1.91, Math.max(0.8, tallest));
}
