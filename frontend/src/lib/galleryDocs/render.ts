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
 *
 * 배치에 기대는 문서(지원서·출품 자료의 약력 두 단, 2026-11-25)를 위해 셋을 더 준다(types.ts DocTools):
 *  - `loadMeasure` — 문서 글꼴(Pretendard)로 글자 폭을 잰다(canvas measureText · FontFace). 못 받으면 대강(approxMeasure)
 *  - 그림 크기 — `prepareImages` 가 줄일 때 적어 둔다(사진 순서 · 사진 칸 비율)
 *  - `layoutProbe` — pdfmake 로 **배치만** 해 보고 쪽 수 · 표시 위치를 얻는다. 그리기(글꼴 심기·PDF 쓰기) 전에 멈춰서 싸다
 */
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import toast from 'react-hot-toast';
import regularUrl from '@/assets/fonts/Pretendard-Regular.otf?url';
import boldUrl from '@/assets/fonts/Pretendard-Bold.otf?url';
import api from '@/lib/axios';
import { fetchImage, mapLimit, prefetchImages, recoverFailed } from '@/lib/imageFetch';
import { FB_CJK, FB_EMOJI, FONT, collectFallbackChars } from './text';
import { kstDate, kstPeriod } from './format';
import { IMG_PX, type DimsFn, type DocContext, type ImgClass, type ImgFn, type LayoutProbe, type Measure } from './types';
import { approxMeasure } from './cvFlow';

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

// ── 미리 배치 ──────────────────────────────────────────────────────────────
/** 배치를 다 본 뒤 그리기 전에 멈추려고 던지는 표시 */
class LayoutDone extends Error {}

type ProbeReq = { doc: TDocumentDefinitions; id?: string; resolve: (r: { pages: number; top: number | null }) => void; reject: (e: unknown) => void };

/**
 * 여러 문서를 **한 번에** 배치해 본다 — 문서마다 새 쪽에서 시작하게 이어 붙이고, 문서마다 표시 이름을 바꿔 위치를 가려 받는다.
 * 왜 한 번에: pdfmake 는 createPdf 마다 글꼴(Pretendard 1.5MB × 굵기)을 다시 읽어 문서 크기와 상관없이 한 번에 약 60ms 가 든다
 * (2026-11-25 실측 — 서른 명 출품 자료의 미리 배치가 따로따로면 1.9초, 한 번에 하면 그 한 번).
 *  - 쪽 수: 문서 끝에 자리를 차지하지 않는 표시(absolutePosition)를 두어 끝난 쪽을 받는다 → 앞 문서 끝 쪽과의 차
 *  - 표시 위치: 그 문서 안의 `id` 조각(본문 맨 위 줄기)을 `__probe-mark-i` 로 바꿔 받는다
 * pdfmake 는 배치를 마친 뒤 그리기 전에 `pageBreakBefore` 를 조각마다 순서대로 부른다 — 마지막 문서 끝 표시에서 던져 그리기를 건너뛴다.
 */
async function probeMany(pm: PdfMakeLike, reqs: ProbeReq[]): Promise<{ pages: number; top: number | null }[]> {
  const mark = (i: number) => `__probe-mark-${i}`;
  const end = (i: number) => `__probe-end-${i}`;
  const content = reqs.map((r, i) => {
    const raw = r.doc.content;
    const list = (Array.isArray(raw) ? raw : [raw]).map((n) => (r.id && (n as { id?: string } | null)?.id === r.id ? { ...(n as object), id: mark(i) } : n));
    list.push({ text: '.', fontSize: 1, color: '#ffffff', id: end(i), absolutePosition: { x: 0, y: 0 } } as never);
    return { stack: list, ...(i ? { pageBreak: 'before' } : {}) };
  });
  const endPage: number[] = [];
  const top: (number | null)[] = reqs.map(() => null);
  const last = reqs.length - 1;
  const stop = new LayoutDone();
  type Info = { id?: string; startPosition?: { top?: number; pageNumber?: number } };
  const pageBreakBefore = (n: Info) => {
    const id = n.id;
    if (!id || !id.startsWith('__probe-')) return false;
    const i = Number(id.slice(id.lastIndexOf('-') + 1));
    if (id === mark(i)) top[i] = n.startPosition?.top ?? null;
    else if (id === end(i)) {
      endPage[i] = n.startPosition?.pageNumber ?? 0;
      if (i === last) throw stop;
    }
    return false;
  };
  const first = reqs[0]!.doc;
  try {
    await pm.createPdf({ ...first, content, pageBreakBefore } as unknown as TDocumentDefinitions).getBlob();
  } catch (e) {
    if (!(e instanceof LayoutDone)) throw e;
  }
  return reqs.map((_, i) => ({ pages: endPage[i] ? endPage[i]! - (i ? endPage[i - 1] ?? 0 : 0) : 0, top: top[i]! }));
}

/**
 * 미리 배치 — 부른 것들을 모았다가 한꺼번에 배치한다(probeMany). 문서들을 나란히 짜면(Promise.all) 첫 번째 미리 배치가 한 번에,
 * 그 결과로 짜는 두 번째 미리 배치가 또 한 번에 돈다. 쪽 크기·여백이 다른 문서는 따로 묶는다.
 */
export function layoutProbe(pm: PdfMakeLike): LayoutProbe {
  let queue: ProbeReq[] = [];
  const flush = async () => {
    const reqs = queue;
    queue = [];
    const groups = new Map<string, ProbeReq[]>();
    for (const r of reqs) {
      const k = JSON.stringify([r.doc.pageSize, r.doc.pageOrientation, r.doc.pageMargins]);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const g of groups.values()) {
      try {
        const res = await probeMany(pm, g);
        g.forEach((r, k) => r.resolve(res[k]!));
      } catch (e) {
        g.forEach((r) => r.reject(e));
      }
    }
  };
  return (doc, id) => new Promise((resolve, reject) => {
    if (!queue.length) setTimeout(flush, 0); // 같은 차례에 부른 것들이 다 모인 뒤
    queue.push({ doc, id, resolve, reject });
  });
}

// ── 글자 폭 ───────────────────────────────────────────────────────────────
const MEASURE_FAMILY = 'ArtLinkDocPretendard';
let measurePromise: Promise<Measure> | null = null;

/**
 * 문서 글꼴로 글자 폭을 재는 함수 — 약력 두 단을 쪽마다 나누고, 사진 옆에 글이 몇 줄 들어가는지 셀 때 쓴다.
 * 같은 OTF 를 FontFace 로 올려 canvas 로 잰다(브라우저가 이미 받아 둔 파일이라 다시 받지 않는다). 못 하면 대강.
 */
export function loadMeasure(): Promise<Measure> {
  measurePromise ??= (async (): Promise<Measure> => {
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) return approxMeasure;
      const faces = [new FontFace(MEASURE_FAMILY, `url(${abs(regularUrl)})`, { weight: '400' }), new FontFace(MEASURE_FAMILY, `url(${abs(boldUrl)})`, { weight: '700' })];
      await Promise.all(faces.map((f) => f.load()));
      faces.forEach((f) => document.fonts.add(f));
      const g = document.createElement('canvas').getContext('2d');
      if (!g) return approxMeasure;
      // ⚠️ 기본(auto)이면 크롬이 글자 폭을 화소 단위로 반올림한다 — 100px 에서 0.5% 좁게 재져, 한 줄에 겨우 들어가는 낱말을
      //    pdfmake(fontkit)는 다음 줄로 넘기는데 우리는 들어간다고 셌다(2026-11-25 실측). geometricPrecision 이면 fontkit 과 같다.
      //    지원하지 않는 브라우저를 위해 크게(1000px) 재서 반올림 오차도 줄인다.
      (g as CanvasRenderingContext2D & { textRendering?: string }).textRendering = 'geometricPrecision';
      const cache = new Map<string, number>();
      return (text, size, bold) => {
        const k = `${bold ? 1 : 0}|${text}`;
        let w = cache.get(k);
        if (w === undefined) {
          g.font = `${bold ? 700 : 400} 1000px ${MEASURE_FAMILY}`;
          w = g.measureText(text).width / 1000;
          cache.set(k, w);
        }
        return w * size;
      };
    } catch {
      return approxMeasure;
    }
  })();
  return measurePromise;
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

/** 원본 → 긴 변 maxPx 이하 JPEG data URL(투명한 곳은 흰 바탕)과 그 크기. 비율은 그대로 — 자르지도 늘리지도 않는다(규칙 18) */
async function shrink(blob: Blob, maxPx: number): Promise<{ data: string; w: number; h: number } | null> {
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
    return { data: out, w, h };
  } finally {
    d.close();
  }
}

/**
 * 적어 둔 그림을 받아 줄인다. 못 받은 그림 주소를 돌려준다(빌더는 빈 칸으로 그리고, 부르는 쪽이 몇 장인지 알린다).
 */
export async function prepareImages(wanted: { url: string; cls: ImgClass }[], onProgress?: DocProgress): Promise<{ img: ImgFn; dims: DimsFn; failed: string[] }> {
  const urls = Array.from(new Set(wanted.map((w) => w.url)));
  let failed = urls.length ? await prefetchImages(urls, (d, t) => onProgress?.(d, t, 'images')) : [];
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.(d, t, 'retry'));
  const bad = new Set(failed);
  const out = new Map<string, string>();
  const size = new Map<string, { w: number; h: number }>();
  await mapLimit(wanted.filter((w) => !bad.has(w.url)), 3, async (w) => {
    const got = await fetchImage(w.url);
    const s = got ? await shrink(got.blob, IMG_PX[w.cls]).catch(() => null) : null;
    if (s) {
      out.set(`${w.cls}:${w.url}`, s.data);
      size.set(w.url, { w: s.w, h: s.h });
    } else bad.add(w.url);
  });
  return {
    img: (url, cls) => (url ? out.get(`${cls}:${url}`) ?? null : null),
    dims: (url) => size.get(url) ?? null,
    failed: Array.from(bad),
  };
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
