/**
 * 갤러리 결과물 PDF 를 브라우저에서 만든다 (2026-11-24, 규칙 92) — 글꼴 · 그림 · 대체 글꼴 · 공모 정보.
 *
 *  - pdfmake 는 **문서를 만들 때만** 받는다(동적 import, 약 0.9MB — PWA 미리받기에서도 뺐다, vite.config.ts)
 *  - Pretendard(보통·굵게 OTF 1.5MB 씩)는 우리 사이트의 해시 파일(assets/)이라 한 번 받으면 브라우저가 1년 쥔다
 *  - 한자·이모지는 **그 문서에 쓰인 글자만** 서버(`/api/fonts/fallback`)에서 받아 심는다 — 못 받으면 빈칸으로 나가므로 알린다
 *  - 그림은 먼저 모두 받아 두고(imageFetch — R2 직접, 실패하면 프록시) **칸 크기에 맞춰 줄여** 심는다.
 *    원본을 그대로 심으면 작품 리스트 한 장이 수십 MB 가 된다
 *
 * 문서 빌더는 두 번 돈다: 처음엔 그림 없이 어떤 그림이 몇 크기로 필요한지 적고(`imageRecorder`),
 * 그림을 준비한 뒤 진짜로 만든다. 빌더가 순수 함수라 두 번 돌아도 같은 문서가 나온다.
 */
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import toast from 'react-hot-toast';
import regularUrl from '@/assets/fonts/Pretendard-Regular.otf?url';
import boldUrl from '@/assets/fonts/Pretendard-Bold.otf?url';
import api from '@/lib/axios';
import { fetchImage, mapLimit, prefetchImages, recoverFailed } from '@/lib/imageFetch';
import { FB_CJK, FB_EMOJI, FONT, collectFallbackChars } from './text';
import { kstDate, kstPeriod } from './format';
import { IMG_PX, type DocContext, type ImgClass, type ImgFn } from './types';

export type DocPhase = 'images' | 'retry' | 'pdf';
export type DocProgress = (done: number, total: number, phase: DocPhase) => void;

interface PdfMakeLike {
  createPdf: (doc: TDocumentDefinitions) => { getBlob: () => Promise<Blob> };
  addFonts: (fonts: Record<string, Record<string, string>>) => void;
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  setUrlAccessPolicy?: (cb: (url: string) => boolean) => void;
  setUrlResourceCaching?: (on: boolean) => void;
}

let pdfMakePromise: Promise<PdfMakeLike> | null = null;
const abs = (u: string) => new URL(u, window.location.href).href;
const pretendard = () => ({ normal: abs(regularUrl), bold: abs(boldUrl), italics: abs(regularUrl), bolditalics: abs(boldUrl) });

/** pdfmake 와 본문 글꼴 — 처음 한 번만 */
export function loadPdfMake(): Promise<PdfMakeLike> {
  pdfMakePromise ??= import('pdfmake/build/pdfmake').then((m) => {
    const anyM = m as unknown as { default?: { default?: PdfMakeLike } & PdfMakeLike } & PdfMakeLike;
    const pm = (anyM.default?.default ?? anyM.default ?? anyM) as PdfMakeLike;
    // 글꼴은 우리 사이트에서만 받는다(문서 안 주소로 바깥을 부르지 않게)
    pm.setUrlAccessPolicy?.((url) => url.startsWith(`${window.location.origin}/`));
    pm.setUrlResourceCaching?.(true);
    pm.addFonts({ [FONT]: pretendard(), [FB_CJK]: pretendard(), [FB_EMOJI]: pretendard() });
    return pm;
  }).catch((e) => { pdfMakePromise = null; throw e; });
  return pdfMakePromise;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let fbSeq = 0;
async function fetchFallback(set: 'cjk' | 'emoji', weight: 400 | 700, text: string): Promise<string | null> {
  try {
    const res = await api.get('/fonts/fallback', { params: { set, weight, text }, responseType: 'arraybuffer', timeout: 20000 });
    return toBase64(res.data as ArrayBuffer);
  } catch {
    return null;
  }
}

/** 머리말·꼬리말 함수가 만드는 조각 — 대체 글꼴 글자를 모을 때 함께 본다 */
function chromeOf(doc: TDocumentDefinitions): unknown[] {
  const size = { width: 595.28, height: 841.89, orientation: 'portrait' };
  const call = (f: unknown) => {
    if (typeof f !== 'function') return f;
    try { return (f as (...a: unknown[]) => unknown)(2, 3, size); } catch { return null; }
  };
  return [call(doc.header), call(doc.footer)];
}

/**
 * 문서들에 쓰인 한자·이모지만 담은 글꼴을 받아 등록한다. 모두 받았으면 true.
 * 못 받은 글자는 본문 글꼴로 남아 빈칸으로 찍힌다 — 그 사실을 한 번 알린다(조용히 빠지지 않게).
 */
export async function prepareFallbackFonts(pm: PdfMakeLike, docs: TDocumentDefinitions[]): Promise<boolean> {
  const { cjk, emoji } = collectFallbackChars(...docs.map((d) => [d.content, chromeOf(d)]));
  if (!cjk && !emoji) return true;
  const id = ++fbSeq;
  const [c4, c7, e4] = await Promise.all([
    cjk ? fetchFallback('cjk', 400, cjk) : Promise.resolve(null),
    cjk ? fetchFallback('cjk', 700, cjk) : Promise.resolve(null),
    emoji ? fetchFallback('emoji', 400, emoji) : Promise.resolve(null),
  ]);
  const vfs: Record<string, string> = {};
  const fonts: Record<string, Record<string, string>> = {};
  if (c4) {
    const n4 = `fb-cjk-${id}-400.ttf`;
    const n7 = c7 ? `fb-cjk-${id}-700.ttf` : n4;
    vfs[n4] = c4;
    if (c7) vfs[n7] = c7;
    fonts[FB_CJK] = { normal: n4, bold: n7, italics: n4, bolditalics: n7 };
  } else fonts[FB_CJK] = pretendard();
  if (e4) {
    const n = `fb-emoji-${id}.ttf`;
    vfs[n] = e4;
    fonts[FB_EMOJI] = { normal: n, bold: n, italics: n, bolditalics: n };
  } else fonts[FB_EMOJI] = pretendard();
  if (Object.keys(vfs).length) pm.addVirtualFileSystem(vfs);
  pm.addFonts(fonts);
  const ok = (!cjk || !!c4) && (!emoji || !!e4);
  if (!ok) toast.error('한자·이모지 일부를 불러오지 못해 빈칸으로 나왔어요. 잠시 뒤 다시 받아 주세요.', { duration: 8000 });
  return ok;
}

/** 문서 정의 → PDF Blob */
export async function renderDoc(pm: PdfMakeLike, doc: TDocumentDefinitions): Promise<Blob> {
  return pm.createPdf(doc).getBlob();
}

// ── 그림 ──────────────────────────────────────────────────────────────────
/** 빌더를 그림 없이 돌려 '어떤 그림을 어느 크기로' 적어 둔다 */
export function imageRecorder(): { img: ImgFn; wanted: { url: string; cls: ImgClass }[] } {
  const seen = new Set<string>();
  const wanted: { url: string; cls: ImgClass }[] = [];
  const img: ImgFn = (url, cls) => {
    if (url && !seen.has(`${cls}:${url}`)) { seen.add(`${cls}:${url}`); wanted.push({ url, cls }); }
    return null;
  };
  return { img, wanted };
}

async function decode(blob: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* 아래 <img> 로 */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    return { src: im, w: im.naturalWidth, h: im.naturalHeight, close: () => {} };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 원본 → 긴 변 maxPx 이하 JPEG data URL(투명한 곳은 흰 바탕). 비율은 그대로 — 자르지도 늘리지도 않는다(규칙 18) */
async function shrink(blob: Blob, maxPx: number): Promise<string | null> {
  const d = await decode(blob);
  if (!d || !d.w || !d.h) return null;
  try {
    const s = Math.min(1, maxPx / Math.max(d.w, d.h));
    const w = Math.max(1, Math.round(d.w * s));
    const h = Math.max(1, Math.round(d.h * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(d.src, 0, 0, w, h);
    const out = c.toDataURL('image/jpeg', 0.86);
    c.width = 0; c.height = 0;
    return out;
  } finally {
    d.close();
  }
}

/**
 * 적어 둔 그림을 받아 줄인다. 못 받은 그림 주소를 돌려준다(빌더는 빈 칸으로 그리고, 부르는 쪽이 몇 장인지 알린다).
 */
export async function prepareImages(wanted: { url: string; cls: ImgClass }[], onProgress?: DocProgress): Promise<{ img: ImgFn; failed: string[] }> {
  const urls = Array.from(new Set(wanted.map((w) => w.url)));
  let failed = urls.length ? await prefetchImages(urls, (d, t) => onProgress?.(d, t, 'images')) : [];
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.(d, t, 'retry'));
  const bad = new Set(failed);
  const out = new Map<string, string>();
  await mapLimit(wanted.filter((w) => !bad.has(w.url)), 3, async (w) => {
    const got = await fetchImage(w.url);
    const data = got ? await shrink(got.blob, IMG_PX[w.cls]).catch(() => null) : null;
    if (data) out.set(`${w.cls}:${w.url}`, data);
    else bad.add(w.url);
  });
  return { img: (url, cls) => (url ? out.get(`${cls}:${url}`) ?? null : null), failed: Array.from(bad) };
}

// ── 공모 정보 ─────────────────────────────────────────────────────────────
/** 문서 머리의 공모 정보 — 공개 상세에서(운영 화면은 제목만 안다). 못 받아도 제목만으로 만든다 */
export async function loadDocContext(exhibitionId: string | number | null | undefined, fallbackTitle = ''): Promise<DocContext> {
  const issued = kstDate(new Date());
  if (exhibitionId == null || exhibitionId === '') return { exTitle: fallbackTitle, issuer: '', period: '', issued, contact: '' };
  try {
    const ex = (await api.get(`/exhibitions/${exhibitionId}`)).data;
    let gallery: { name?: string; phone?: string; address?: string } | null = null;
    if (ex?.gallery?.id) {
      try { gallery = (await api.get(`/galleries/${ex.gallery.id}`)).data; } catch { gallery = ex.gallery; }
    }
    return {
      exTitle: ex?.title || fallbackTitle,
      issuer: gallery?.name || ex?.gallery?.name || (ex?.hostType === 'ADMIN' ? '아트링크' : ''),
      period: kstPeriod(ex?.exhibitStartDate, ex?.exhibitDate),
      issued,
      contact: [gallery?.phone, gallery?.address].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · '),
    };
  } catch {
    return { exTitle: fallbackTitle, issuer: '', period: '', issued, contact: '' };
  }
}
