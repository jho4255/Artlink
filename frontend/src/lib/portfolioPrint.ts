/**
 * 포트폴리오 **벡터 PDF** — 브라우저 인쇄 경로 (2026-09-16, 사용자 결정).
 *
 * ## 왜 인쇄 경로인가
 * 기존 `renderPagesToPdf` 는 페이지를 html2canvas 로 **통째로 JPEG 로 굽는다**. 그래서
 *   - 글자가 그림이 된다 — 심사자가 이름·이메일을 복사하거나 Ctrl+F 로 찾을 수 없다(실측: 34쪽 PDF 의 텍스트 0자)
 *   - 쪽마다 600KB 가 붙는다 — 34쪽이 22MB 로 국내 공모 한도(10~20MB)를 넘는다
 *   - html2canvas 가 못 그리는 CSS(`color-mix` 등)에 통째로 실패한다
 * 같은 페이지 HTML 을 브라우저의 인쇄 → 'PDF 로 저장' 으로 뽑으면 글자가 글자로 남고(글꼴 내장), 선·배경은 벡터,
 * 사진만 비트맵이다. 실험(Chromium): 18쪽 2초, 텍스트 4,415자 추출. 서버도 라이브러리도 필요 없다.
 *
 * ## 사진은 미리 줄여 넣는다
 * 인쇄 경로는 `<img>` 원본을 그대로 내장한다 — 원본 4,000px 사진 27장이면 20MB 가 넘는다(실험 20.6MB).
 * A4 240dpi 에 필요한 건 긴 변 ≈2,000px 이라(공모 요강의 이미지 규격 1,500~2,000px 과도 같다) 그 이상은 canvas 로 줄여
 * JPEG data URL 로 바꾼다. 원본보다 키우지는 않는다(§18). 실측: 27점 → 약 5~7MB.
 *
 * ## 대화상자
 * `window.print()` 는 인쇄 대화상자를 연다. 사용자가 대상에서 'PDF 로 저장' 을 고른다(크롬은 마지막 선택을 기억한다).
 * 여백은 `@page { margin:0 }` 으로 0, 배경은 `print-color-adjust: exact` 로 강제한다(대화상자의 '배경 그래픽' 체크와 무관).
 * 파일 이름은 문서 `<title>` 에서 온다.
 *
 * ⚠️ 판형은 `@page size` 와 `.pg` 크기를 **둘 다 mm 로** 적는다. px 로 적고 mm 로 환산하면 소수점 반올림 차이로
 *    쪽마다 빈 장이 끼어든다(실험에서 겪었다). 페이지 HTML(1000px 폭)은 `transform: scale` 로 mm 상자에 맞춘다 —
 *    변환은 벡터를 유지한다.
 * ⚠️ 옛 래스터 경로(`downloadPortfolioBook`)는 '이미지형 PDF' 로 남긴다 — 인쇄 대화상자가 막힌 환경(일부 인앱 브라우저)용.
 */
import { PORTFOLIO_FONT_HREF } from './portfolioFonts';
import { prefetchImages, recoverFailed } from './imageFetch';
import { displayName } from './utils';
import { safeName } from './operationPdf';
import {
  applyDesign, bookImageUrls, buildPortfolioPages, normalizePdfDesign, themeById,
  type BookPhase, type PortfolioBookData, type PortfolioPage, type PortfolioTheme,
} from './portfolioFormats';

/** index.html 이 받는 글꼴 — 인쇄 문서는 별도 문서라 같은 글꼴을 다시 붙여야 한다(안 붙이면 폴백 글꼴로 찍힌다) */
const BASE_FONT_LINKS = [
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
  'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&display=swap',
  PORTFOLIO_FONT_HREF,
];

export interface PrintImageSpec {
  /** 긴 변 상한(px). 이보다 큰 사진만 줄인다 */
  maxEdge: number;
  /** JPEG 품질 0~1 */
  quality: number;
}
/** A4 240dpi ≈ 2,000px. 공모 요강의 이미지 규격(1,500~2,000px)과도 맞는다 */
export const PRINT_IMAGE: PrintImageSpec = { maxEdge: 2000, quality: 0.86 };
/**
 * 용량 예산에 맞추는 단계 — 위에서부터 시도해 예산 안에 들어오는 첫 단계를 쓴다.
 * 실측(박기량 27점, 세밀한 채색): 2000px/0.86 이 **18MB** 였다. 국내 공모 한도(SeMA·리플랫 10MB)를 기본으로 맞춘다.
 * 마지막 단계(1,200px)도 A4 에서 145dpi·공모 요강 최소 규격(1,280px) 근처라 화면·심사용으로는 충분하다.
 */
export const PRINT_LADDER: PrintImageSpec[] = [
  PRINT_IMAGE,
  { maxEdge: 1800, quality: 0.82 },
  { maxEdge: 1600, quality: 0.8 },
  { maxEdge: 1400, quality: 0.76 },
  { maxEdge: 1200, quality: 0.72 },
];
/** 기본 용량 예산 — 10MB 한도에 PDF 자체 오버헤드(글꼴·벡터 ≈ 0.3~0.5MB)를 남긴 값 */
export const PRINT_BUDGET_BYTES = 9.4 * 1048576;

/**
 * 예산 안에 들어올 때까지 사진을 단계적으로 더 줄인다. 어느 단계로도 안 들어가면 마지막 단계를 쓴다(그래도 저장은 된다).
 * 반환 `spec` 은 실제로 쓴 단계 — 화면이 "1,400px 로 줄였습니다" 처럼 알려 줄 수 있다.
 */
export async function shrinkToBudget(
  pages: PortfolioPage[], bg: string, budget = PRINT_BUDGET_BYTES,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: PortfolioPage[]; bytes: number; spec: PrintImageSpec }> {
  // 첫 단계로 재 보고, 넘치면 **비율로 단계를 바로 고른다** — 사다리를 한 칸씩 내려가며 27장을 매번 다시 굽는 건
  // 20초가 넘는다(실측). JPEG 용량은 대략 픽셀 수에 비례하고 품질에는 그보다 완만하게 비례한다.
  const first = PRINT_LADDER[0]!;
  let out = await shrinkPageImages(pages, bg, first, onProgress);
  if (out.bytes <= budget) return { ...out, spec: first };
  const factor = (s: PrintImageSpec) => (s.maxEdge / first.maxEdge) ** 2 * (s.quality / first.quality) ** 1.5;
  const need = (budget / out.bytes) * 0.92;                     // 추정 오차 여유
  let i = PRINT_LADDER.findIndex((s) => factor(s) <= need);
  if (i < 0) i = PRINT_LADDER.length - 1;
  for (; i < PRINT_LADDER.length; i++) {
    out = await shrinkPageImages(pages, bg, PRINT_LADDER[i]!, onProgress);
    if (out.bytes <= budget) return { ...out, spec: PRINT_LADDER[i]! };
  }
  return { ...out, spec: PRINT_LADDER[PRINT_LADDER.length - 1]! };
}

/**
 * 페이지 HTML 안의 사진 주소를 **줄인 JPEG data URL** 로 바꾼다.
 * blob:/동일출처 주소만 canvas 에 그릴 수 있다 — 교차출처(원본 R2 주소)라 taint 되면 그대로 둔다(내장은 되지만 크다).
 * 반환 `bytes` 는 내장될 사진 바이트 합(용량 안내용).
 */
export async function shrinkPageImages(
  pages: PortfolioPage[], bg: string, spec: PrintImageSpec = PRINT_IMAGE,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: PortfolioPage[]; bytes: number }> {
  const srcRe = /(?:src="|url\(')([^"')]+)(?:"|'\))/g;
  const urls = new Set<string>();
  for (const p of pages) for (const m of p.html.matchAll(srcRe)) if (m[1] && !m[1].startsWith('data:')) urls.add(m[1]);
  const map = new Map<string, string>();
  let bytes = 0, done = 0;
  const list = [...urls];
  await Promise.all(list.map(async (u) => {
    const out = await shrinkOne(u, bg, spec);
    if (out) { map.set(u, out); bytes += Math.round((out.length - out.indexOf(',') - 1) * 0.75); }
    onProgress?.(++done, list.length);
  }));
  const swap = (html: string) => html.replace(srcRe, (whole, u: string) => {
    const d = map.get(u);
    return d ? whole.replace(u, d) : whole;
  });
  return { pages: pages.map((p) => ({ ...p, html: swap(p.html) })), bytes };
}

function shrinkOne(url: string, bg: string, spec: PrintImageSpec): Promise<string | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      try {
        const long = Math.max(im.naturalWidth, im.naturalHeight);
        if (!long) return resolve(null);
        const k = Math.min(1, spec.maxEdge / long);          // 원본보다 키우지 않는다(§18)
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const x = c.getContext('2d');
        if (!x) return resolve(null);
        x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);   // 투명 PNG 는 지면색 위에 앉힌다
        x.drawImage(im, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', spec.quality));       // 교차출처 taint 면 여기서 던진다 → null
      } catch { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

/** 인쇄용 HTML 문서 — 장마다 판형(mm) 상자 하나, 그 안에 페이지 HTML 을 축소해 앉힌다 */
export function buildPrintDocument(pages: PortfolioPage[], theme: PortfolioTheme, title: string): string {
  const { w, h, mmW, mmH } = theme.page;
  const scale = ((mmW / 25.4) * 96) / w;                      // 1000px → 210mm
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
${BASE_FONT_LINKS.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
<style>
@page { size: ${mmW}mm ${mmH}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: ${theme.bg}; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg { width: ${mmW}mm; height: ${mmH}mm; overflow: hidden; position: relative; break-after: page; page-break-after: always; }
.pg:last-child { break-after: auto; page-break-after: auto; }
.in { transform-origin: 0 0; transform: scale(${scale.toFixed(6)}); width: ${w}px; height: ${h}px; }
</style></head><body>${pages.map((p) => `<div class="pg"><div class="in">${p.html}</div></div>`).join('\n')}</body></html>`;
}

/** 숨은 iframe 에 문서를 써 넣고 인쇄 대화상자를 연다. 글꼴·사진이 다 뜬 뒤에 연다(안 그러면 폴백 글꼴·빈 칸이 찍힌다) */
export async function printDocument(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) { frame.remove(); throw new Error('인쇄 창을 만들 수 없습니다.'); }
  const doc = win.document;
  doc.open(); doc.write(html); doc.close();
  try { await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* 지원 안 하면 그대로 */ }
  await Promise.all(Array.from(doc.images).map((im) => im.complete ? Promise.resolve()
    : new Promise<void>((r) => { im.addEventListener('load', () => r(), { once: true }); im.addEventListener('error', () => r(), { once: true }); })));
  // 대화상자가 닫히면 치운다. afterprint 를 안 주는 브라우저용으로 넉넉한 시한도 둔다(그 전에 치우면 미리보기가 깨진다).
  const cleanup = () => { frame.remove(); };
  win.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, 10 * 60 * 1000);
  win.focus();
  win.print();
}

/**
 * 포트폴리오 → 벡터 PDF (인쇄 대화상자).
 * 반환: 못 받은 사진 주소, 쪽수, 내장 사진 용량(MB 안내용).
 */
export async function printPortfolioBook(
  data: PortfolioBookData,
  design: unknown,
  onProgress?: (done: number, total: number, phase: BookPhase) => void,
  budget = PRINT_BUDGET_BYTES,
): Promise<{ missing: string[]; pages: number; imageBytes: number; maxEdge: number }> {
  const d = normalizePdfDesign(design);
  const theme = applyDesign(themeById('archive'), d);
  const urls = bookImageUrls(data);
  let failed = urls.length ? await prefetchImages(urls, (x, t) => onProgress?.(x, t, 'images')) : [];
  if (failed.length) failed = await recoverFailed(failed, (x, t) => onProgress?.(x, t, 'retry'));
  const built = buildPortfolioPages(data, themeById('archive'), { forPdf: true, design });
  const { pages, bytes, spec } = await shrinkToBudget(built, theme.bg, budget, (x, t) => onProgress?.(x, t, 'render'));
  await printDocument(buildPrintDocument(pages, theme, `${safeName(displayName(data.user))}_포트폴리오`));
  return { missing: failed, pages: pages.length, imageBytes: bytes, maxEdge: spec.maxEdge };
}
