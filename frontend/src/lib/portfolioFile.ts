/**
 * 작가 홈페이지의 [포트폴리오] 탭 — 첨부한 포트폴리오 파일을 **내려받게 하지 않고 페이지 안에서 펼쳐 보인다**(2026-09-25).
 *
 * 판정과 치수 계산만 여기 둔다(순수 함수 — 테스트는 `__tests__/portfolioFile.test.ts`). 그리는 쪽은 `components/shared/PdfViewer.tsx`.
 *
 * - 펼쳐 보일 수 있는 건 **PDF 뿐**이다. HWP·DOC·ZIP 은 브라우저가 그릴 방법이 없어 [내려받기]로 남는다.
 *   업로드 칸(`PortfolioFileInput`)이 "PDF 로 올리면 홈페이지에서 바로 보인다"고 미리 알린다.
 * - 판정은 **주소의 확장자**로 한다. 업로드 키가 `타임스탬프-난수.pdf` 처럼 원래 확장자를 그대로 달고 있다(`routes/upload.ts`).
 */

export type PortfolioFileKind = 'pdf' | 'other';

/** 주소에서 확장자(소문자, 점 없이) — 쿼리·해시는 뗀다 */
export function fileExtension(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0] ?? '';
  const last = path.substring(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase();
}

/** 페이지 안에서 펼칠 수 있는가 */
export function portfolioFileKind(url: string | null | undefined): PortfolioFileKind | null {
  if (!url) return null;
  return fileExtension(url) === 'pdf' ? 'pdf' : 'other';
}

/** 화면에 적는 형식 이름 — "HWP 문서" 처럼. 모르면 '파일' */
export function fileTypeLabel(url: string | null | undefined): string {
  const ext = fileExtension(url);
  switch (ext) {
    case 'pdf': return 'PDF';
    case 'hwp': case 'hwpx': return '한글(HWP) 문서';
    case 'doc': case 'docx': return '워드 문서';
    case 'zip': return '압축 파일';
    default: return '파일';
  }
}

/** 바이트 → "8.4MB" / "730KB" */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 화면에 놓을 때 PDF 1pt 가 차지하는 최대 CSS px — A4 세로(595pt)가 1000px 이 되는 배율.
 * 그러면 10pt 본문이 약 17px 로, 이 사이트의 본문 글자(16px)와 비슷한 크기로 읽힌다.
 */
export const PDF_MAX_CSS_PER_PT = 1000 / 595;

/**
 * PDF 한 쪽을 화면에 몇 px 폭으로 놓을지 — **컨테이너 폭에 맞추되, 글자가 사이트 본문보다 커지지는 않게**.
 *
 * ⚠️ 2026-10-15 까지는 "한 쪽이 한 화면에" 들어오게 **높이에** 맞췄다(하한 640px). 그러면 PC 에서 A4 세로가 늘 640px 이라
 *    10pt 본문이 7px 남짓이 됐고, 보통 모니터(기기 배율 1)에서는 글자가 뭉개져 보였다("홈페이지에서 포트폴리오를 보면 글자가 뭉개지고 흐리다").
 *    그리는 건 픽셀 단위로 정확했다(같은 크기로 PyMuPDF 가 그린 것과 같다) — **작게 놓은 게 원인**이었다.
 *    지금은 크롬 PDF 보기와 같이 폭에 맞춘다. 대신 한 쪽을 보려면 스크롤한다.
 *  - 상한은 폭이 아니라 **배율**(`maxScale`)로 건다 — A4 가로·16:9 는 같은 글자 크기에서 더 넓으므로 컨테이너까지 쓴다.
 *  - 휴대폰은 늘 컨테이너 폭(= 화면 폭). 그 크기에서 글자를 읽으려면 손가락으로 확대한다 — 그때 다시 그린다(`pdfRenderScale` 의 zoom).
 *
 * @param pageWidthPt 쪽 폭(pt). 모르면 A4 세로로 본다
 */
export function pdfPageWidth({ containerWidth, pageWidthPt, maxScale = PDF_MAX_CSS_PER_PT }: {
  containerWidth: number; pageWidthPt: number; maxScale?: number;
}): number {
  if (!(containerWidth > 0)) return 0;
  const pt = pageWidthPt > 0 && Number.isFinite(pageWidthPt) ? pageWidthPt : 595;
  return Math.floor(Math.min(containerWidth, pt * maxScale));
}

/** 기기 배율 상한 — 요즘 휴대폰은 3배(아이폰·갤럭시)다 */
export const PDF_MAX_DPR = 3;
/** 평소 한 쪽의 픽셀 상한 — A4 를 휴대폰 3배로 그려도 2M px 남짓이라 보통은 닿지 않는다(아주 긴 쪽만 걸린다) */
export const PDF_MAX_PIXELS = 8_000_000;
/** 확대해서 볼 때 한 쪽의 픽셀 상한 — iOS 는 캔버스 한 장이 16.7M px(4096²)를 넘으면 빈 판이 된다. 확대 중 다시 그리는 건 보이는 쪽 둘뿐이다 */
export const PDF_ZOOM_MAX_PIXELS = 12_000_000;
/** 확대해서 볼 때 다시 그리는 배율 계단 — 손가락을 움직일 때마다가 아니라 계단을 넘을 때만 다시 그린다 */
export const PDF_ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

/**
 * 캔버스 배율 — 화면 폭 × 기기 배율(최대 3) × 확대 배율로 그리되, **한 장의 픽셀 수에 상한**을 둔다.
 *
 * ⚠️ 2026-10-15 까지는 기기 배율을 **2로 묶었다** — 그래서 3배 화면(아이폰·갤럭시)에서는 그린 그림을 1.5배 늘려 보여 줬고,
 *    손가락으로 확대해도 다시 그리지 않아 늘린 그림을 또 늘렸다("홈페이지에서 포트폴리오를 보면 화질이 깨진다").
 *    메모리는 배율을 묶어서가 아니라 **픽셀 상한**과 '화면에서 멀어진 쪽은 비운다'(`PdfViewer`)로 지킨다.
 * iOS Safari 는 캔버스 메모리가 작다(한 장 16.7M px, 전체 수백 MB) — 상한을 그 아래로 둔다.
 *
 * @param zoom 손가락·트랙패드로 확대한 배율(`pdfZoomStep` 을 거친 값). 1 이면 평소대로.
 */
export function pdfRenderScale({ cssWidth, pageWidthPt, pageHeightPt, dpr, zoom = 1, maxPixels }: {
  cssWidth: number; pageWidthPt: number; pageHeightPt: number; dpr: number; zoom?: number; maxPixels?: number;
}): number {
  if (!(cssWidth > 0) || !(pageWidthPt > 0) || !(pageHeightPt > 0)) return 0;
  const z = Math.min(Math.max(zoom || 1, 1), PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1]);
  const ratio = Math.min(Math.max(dpr || 1, 1), PDF_MAX_DPR) * z;
  let scale = (cssWidth * ratio) / pageWidthPt;
  const cap = maxPixels ?? (z > 1 ? PDF_ZOOM_MAX_PIXELS : PDF_MAX_PIXELS);
  const area = pageWidthPt * scale * pageHeightPt * scale;
  if (area > cap) scale *= Math.sqrt(cap / area);
  return scale;
}

/** 1.25 → [5, 4] · 1.1 → [11, 10] · 2.625 → [21, 8] — 분모 10 이하의 가장 가까운 분수(pdf.js 뷰어의 approximateFraction 과 같은 생각) */
export function ratioFraction(x: number, limit = 10): [number, number] {
  if (!(x > 0) || !Number.isFinite(x)) return [1, 1];
  let best: [number, number] = [Math.max(1, Math.round(x)), 1];
  let err = Math.abs(x - best[0]);
  for (let d = 2; d <= limit; d++) {
    const n = Math.round(x * d);
    const e = Math.abs(x - n / d);
    if (n > 0 && e < err - 1e-9) { best = [n, d]; err = e; }
  }
  return best;
}
const floorTo = (v: number, d: number) => Math.max(d, v - (v % d));

/**
 * 쪽 상자(CSS px) — **기기 배율을 곱했을 때 정수 픽셀로 떨어지게** 폭·높이를 배율 분모의 배수로 맞춘다.
 *
 * ⚠️⚠️ 캔버스 픽셀 수가 상자의 기기 픽셀 수와 1px 이라도 다르면 브라우저가 **캔버스 전체를 다시 보간해** 그려 쪽 전체가 흐려진다
 *    (2026-10-15 실측 — "글자가 뭉개지고 흐리다"의 두 번째 원인). 예전엔 상자 높이를 반올림(1414)하고 캔버스는 내림(1413)이라
 *    **모든 배율에서** 한 줄씩 늘려 그렸고, 1.25배(윈도 노트북 기본) 화면은 폭도 999 × 1.25 = 1248.75 로 떨어지지 않았다.
 *    분모가 4 면 상자 폭은 4 의 배수(최대 3px 줄어든다), 높이도 같다 — 쪽 맨 아래 몇 px 이 비거나 잘리는 정도다.
 */
export function pdfPageBox({ cssWidth, pageWidthPt, pageHeightPt, dpr }: {
  cssWidth: number; pageWidthPt: number; pageHeightPt: number; dpr: number;
}): { w: number; h: number } {
  if (!(cssWidth > 0) || !(pageWidthPt > 0) || !(pageHeightPt > 0)) return { w: 0, h: 0 };
  const [, d] = ratioFraction(Math.min(Math.max(dpr || 1, 1), PDF_MAX_DPR));
  const w = floorTo(Math.floor(cssWidth), d);
  const h = Math.max(d, Math.round((w * pageHeightPt) / pageWidthPt / d) * d);   // 높이는 가장 가까운 배수(비율이 덜 틀어진다)
  return { w, h };
}

/**
 * 캔버스 픽셀 크기 — `pdfRenderScale` 의 배율로 **상자를 그대로 곱한다**(반올림만). 상자가 `pdfPageBox` 로 잡혀 있으면
 * 평소(확대 안 함·픽셀 상한 안 걸림)에는 정확히 기기 픽셀과 같아져 보간 없이 1:1 로 찍힌다.
 */
export function pdfCanvasSize(box: { w: number; h: number }, page: { w: number; h: number }, dpr: number, zoom = 1): { w: number; h: number; scale: number } {
  const scale = pdfRenderScale({ cssWidth: box.w, pageWidthPt: page.w, pageHeightPt: page.h, dpr, zoom });
  if (!(scale > 0)) return { w: 0, h: 0, scale: 0 };
  const k = (scale * page.w) / box.w;            // CSS px → 캔버스 px
  const w = Math.round(box.w * k);
  return { w, h: Math.round(box.h * k), scale: w / page.w };
}

/** 지금 확대 배율(visualViewport.scale) → 다시 그릴 계단. 조금 넘으면 위 계단으로 올린다(1.2배면 1.5배로 그려 둔다) */
export function pdfZoomStep(scale: number): number {
  if (!(scale > 1.1)) return 1;
  for (const s of PDF_ZOOM_STEPS) if (s >= scale - 0.05) return s;
  return PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1];
}

export interface ViewBox { top: number; left: number; width: number; height: number }
/**
 * 확대해서 볼 때 **어느 쪽을 선명하게 다시 그릴까** — 지금 보이는 영역(visualViewport)과 겹치는 쪽, 겹치는 면적이 큰 순으로 최대 `max` 개.
 * 겹치는 쪽이 없다고 나오면(브라우저마다 좌표 기준이 조금씩 달라 어긋나는 경우) 보이는 영역 가운데에 가장 가까운 쪽 하나.
 * 좌표는 둘 다 레이아웃 뷰포트 기준(getBoundingClientRect · visualViewport.offsetTop/Left).
 */
export function pagesInView(pages: { n: number; r: { top: number; bottom: number; left: number; right: number } }[], view: ViewBox, max = 2): number[] {
  if (pages.length === 0) return [];
  const vb = view.top + view.height, vr = view.left + view.width;
  const scored = pages.map(({ n, r }) => {
    const h = Math.min(r.bottom, vb) - Math.max(r.top, view.top);
    const w = Math.min(r.right, vr) - Math.max(r.left, view.left);
    return { n, area: h > 0 && w > 0 ? h * w : 0, dist: Math.abs((r.top + r.bottom) / 2 - (view.top + view.height / 2)) };
  });
  const hit = scored.filter((s) => s.area > 0).sort((a, b) => b.area - a.area).slice(0, max).map((s) => s.n);
  if (hit.length) return hit;
  return [scored.sort((a, b) => a.dist - b.dist)[0]!.n];
}
