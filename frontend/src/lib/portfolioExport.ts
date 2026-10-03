/**
 * 포트폴리오 PDF **바로 내려받기** (2026-10-03, 사용자 결정) — [PDF 저장] 의 기본 경로.
 *
 * ## 왜 인쇄 창이 기본이 아닌가
 * 2026-09-16 부터 [PDF 저장] 은 브라우저 인쇄 → 'PDF 로 저장' 이었다(`portfolioPrint.ts` — 글자가 살아 있는 PDF).
 * 결과물은 더 좋지만 **처음 온 작가가 못 썼다**(2026-10-02 조사): 버튼을 누르면 파일이 아니라 인쇄 창이 뜨고,
 * 거기서 대상을 'PDF 로 저장' 으로 바꿔야 한다는 안내는 버튼 아래 11px 회색 글씨뿐이었으며,
 * 인쇄가 막힌 인앱 브라우저에서는 눌러도 아무 일이 없는데 화면은 성공이라고 말했다.
 * 그리고 인쇄 경로로는 **사이트가 파일을 받을 수 없다** — 만든 PDF 를 홈페이지·지원서에 바로 붙일 길이 없었다.
 *
 * 지금은 누르면 파일이 내려받아진다. 쪽마다 그림 한 장(JPEG)이라 글자 선택·검색은 안 된다 — 그게 필요한 사람은
 * 저장 창의 '글자가 살아 있는 PDF'(인쇄 경로)를 고른다.
 *
 * ## 용량
 * 국내 공모의 파일 한도는 대개 10MB 다(SeMA·리플랫 등, 2026-09 조사). 기준 해상도(≈240dpi · JPEG 0.9)로 한 번 굽고,
 * 넘칠 때만 **이미 구운 JPEG 를 줄여 다시 압축**한다(`recompress`) — 쪽을 다시 그리지 않는다.
 * 쪽 그리기(html2canvas)가 가장 느린 단계라(쪽당 PC 0.8초 · 휴대폰 3~4초) 두 번 그리면 휴대폰에서 1분이 넘는다.
 * 몇 단계로 줄일지는 실제로 구운 용량에서 바로 고른다(`pickStep`) — 한 칸씩 내려가며 매번 다시 굽지 않는다.
 *
 * ⚠️ 쪽 HTML 에 `color-mix()` 를 쓰면 여기서 통째로 실패한다(html2canvas 가 못 읽는다 — CLAUDE.md 「가이드형 디자인」).
 * ⚠️ 그리기 전에 `prefetchImages` 로 사진을 먼저 모은다 — 안 하면 쪽마다 프록시 왕복이 붙는다(`imageFetch.ts`).
 */
import api from '@/lib/axios';
import { prefetchImages, recoverFailed } from '@/lib/imageFetch';
import { triggerDownload } from '@/lib/operationPdf';
import {
  applyDesign, bookImageUrls, buildPortfolioPages, normalizePdfDesign, portfolioFileName, themeById, waitPageImages,
  type PortfolioBookData, type PortfolioPage, type PortfolioTheme,
} from '@/lib/portfolioFormats';
import { EXPORT_LADDER, pickStep, type ExportStep } from '@/lib/portfolioMaker';

/** 10MB 한도에 PDF 껍데기(쪽 사전·교차참조 ≈ 수십 KB)와 여유를 남긴 값 — 인쇄 경로와 같은 예산 */
export const EXPORT_BUDGET_BYTES = 9.4 * 1048576;
/** 홈페이지에 올릴 수 있는 크기 — 서버 `/upload/file` 의 한도(20MB)보다 조금 아래 */
export const UPLOAD_MAX_BYTES = 19.5 * 1048576;

export type ExportPhase = 'images' | 'retry' | 'render' | 'shrink';
export type ExportProgress = (phase: ExportPhase, done: number, total: number) => void;

export interface ExportResult {
  blob: Blob;
  fileName: string;
  pages: number;
  /** 실린 작품 수(쪽에 실제로 놓인 수) */
  works: number;
  /** 만든 파일 크기 */
  bytes: number;
  /** 한도에 맞추려고 내려간 단계(0 = 줄이지 않았다) — 화면이 "화질을 조금 낮췄어요" 라고 알린다 */
  step: number;
  /** 가장 낮은 단계로도 한도를 넘었다 — 작품 수를 줄이라고 안내한다 */
  overBudget: boolean;
  /** 끝내 받지 못한 사진 주소 — 그 자리는 빈 칸으로 나간다(조용히 넘어가지 않는다) */
  missing: string[];
}

const dataUrlBytes = (s: string) => Math.round((s.length - s.indexOf(',') - 1) * 0.75);
const sumBytes = (list: string[]) => list.reduce((n, s) => n + dataUrlBytes(s), 0);

/** 기준 배율 — 인쇄 품질 240dpi 를 목표로(판형이 클수록 배율은 낮아진다). `renderPagesToPdf` 와 같은 식 */
export function baseScale(theme: PortfolioTheme): number {
  const { w, mmW } = theme.page;
  return Math.max(1, Math.min(2.4, ((mmW / 25.4) * 240) / w));
}

type Html2Canvas = (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;

/**
 * 쪽마다 한 번씩 그려 JPEG 로 — 0단계(기준 해상도·품질).
 *
 * ⚠️ html2canvas 는 그릴 때마다 **문서 전체를 복제**한다. 제작 화면에는 미리보기 쪽들(쪽마다 수백 노드)이 떠 있어
 *    그대로 두면 쪽 하나를 그릴 때마다 그것까지 전부 복제한다. `ignoreElements` 로 body 의 다른 자식(앱 전체)을 건너뛴다 —
 *    쪽 HTML 은 인라인 스타일뿐이고 글꼴은 <head> 에서 오므로 앱 DOM 이 없어도 같은 그림이 나온다.
 */
async function rasterize(pages: PortfolioPage[], theme: PortfolioTheme, html2canvas: Html2Canvas, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const { w, h } = theme.page;
  const scale = baseScale(theme);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;z-index:-1;background:${theme.bg};`;
  document.body.appendChild(host);
  // 글꼴이 늦게 붙으면 폴백 글꼴로 구워진다 — 표지 큰 글씨에서 바로 티가 난다
  try { await document.fonts?.ready; } catch { /* 지원 안 하는 브라우저는 그대로 */ }
  const out: string[] = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      host.innerHTML = pages[i]!.html;
      await waitPageImages(host);
      const canvas = await html2canvas(host, {
        scale, useCORS: true, backgroundColor: theme.bg, width: w, height: h, logging: false,
        ignoreElements: (el: Element) => el.parentElement === document.body && el !== host,
      });
      out.push(canvas.toDataURL('image/jpeg', EXPORT_LADDER[0]!.quality));
      // 큰 캔버스를 붙들고 있으면 30장 넘는 문서에서 메모리가 터진다(특히 iOS)
      canvas.width = 0; canvas.height = 0;
      onProgress?.(i + 1, pages.length);
    }
  } finally {
    host.remove();
  }
  return out;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error('쪽 그림을 다시 읽지 못했습니다.'));
  im.src = src;
});

/** 이미 구운 쪽(JPEG)을 더 작게 — 줄여 그리고 낮은 품질로 다시 압축한다. 늘 **0단계 그림에서** 만든다(여러 번 거치면 뭉개진다) */
async function recompress(jpegs: string[], step: ExportStep, bg: string, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < jpegs.length; i++) {
    const im = await loadImage(jpegs[i]!);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * step.k));
    c.height = Math.max(1, Math.round(im.naturalHeight * step.k));
    const x = c.getContext('2d');
    if (!x) { out.push(jpegs[i]!); continue; }
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(im, 0, 0, c.width, c.height);
    out.push(c.toDataURL('image/jpeg', step.quality));
    c.width = 0; c.height = 0;
    onProgress?.(i + 1, jpegs.length);
  }
  return out;
}

/**
 * 포트폴리오 → PDF 파일(Blob). 내려받기·올리기는 부르는 쪽이 한다(`saveBlob`·`uploadPortfolioPdf`).
 * `data` 는 미리보기가 쓰는 것과 **같은 객체**여야 한다(`aspects` 포함) — 그래야 화면에서 본 배치 그대로 나온다.
 */
export async function exportPortfolioPdf(
  data: PortfolioBookData, design: unknown,
  opts: { budget?: number; onProgress?: ExportProgress } = {},
): Promise<ExportResult> {
  const budget = opts.budget ?? EXPORT_BUDGET_BYTES;
  const on = opts.onProgress;
  const base = themeById('archive');
  const theme = applyDesign(base, normalizePdfDesign(design));

  const urls = bookImageUrls(data);
  let missing = urls.length ? await prefetchImages(urls, (d, t) => on?.('images', d, t)) : [];
  if (missing.length) missing = await recoverFailed(missing, (d, t) => on?.('retry', d, t));

  const pages = buildPortfolioPages(data, base, { forPdf: true, design });
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);

  const first = await rasterize(pages, theme, html2canvas as unknown as Html2Canvas, (d, t) => on?.('render', d, t));
  let jpegs = first;
  let step = 0;
  if (sumBytes(first) > budget) {
    step = pickStep(sumBytes(first), budget);
    for (;;) {
      jpegs = await recompress(first, EXPORT_LADDER[step]!, theme.bg, (d, t) => on?.('shrink', d, t));
      if (sumBytes(jpegs) <= budget || step >= EXPORT_LADDER.length - 1) break;
      step += 1;   // 추정이 빗나갔다 — 한 칸 더
    }
  }

  const { mmW, mmH } = theme.page;
  const fileName = portfolioFileName(data, design);
  const pdf = new jsPDF({ orientation: mmW > mmH ? 'l' : 'p', unit: 'mm', format: [Math.min(mmW, mmH), Math.max(mmW, mmH)] });
  pdf.setProperties({ title: fileName });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  jpegs.forEach((j, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(j, 'JPEG', 0, 0, pw, ph);
  });
  const blob = pdf.output('blob') as Blob;

  return {
    blob,
    fileName: `${fileName}.pdf`,
    pages: pages.length,
    works: pages.reduce((n, p) => n + (p.works ?? 0), 0),
    bytes: blob.size,
    step,
    // 예산(9.4MB)은 한도(10MB)에서 여유를 남긴 값이다 — 진짜 한도를 넘었을 때만 넘었다고 말한다
    overBudget: blob.size > budget * (10 / 9.4),
    missing,
  };
}

/** 파일을 내려받는다(브라우저의 다운로드) */
export function saveBlob(blob: Blob, fileName: string): void {
  triggerDownload(blob, fileName);
}

/**
 * 만든 PDF 를 우리 저장소에 올리고 주소를 돌려준다 — 지원서·홈페이지의 포트폴리오 파일과 같은 경로(`/upload/file`).
 * 9MB 파일을 느린 회선으로 올리면 기본 시한(15초)을 넘는다 — 이 요청만 넉넉히 준다.
 */
export async function uploadPortfolioPdf(blob: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', new File([blob], fileName, { type: 'application/pdf' }));
  const res = await api.post('/upload/file', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 });
  return res.data.url as string;
}

/** 내 홈페이지 [포트폴리오] 탭의 파일을 이것으로 바꾼다 — 글·디자인은 건드리지 않는다(`PUT /portfolio/file`) */
export async function setHomepagePortfolioFile(url: string): Promise<string> {
  const res = await api.put('/portfolio/file', { portfolioFileUrl: url });
  return res.data.portfolioFileUrl as string;
}

export type ExportMethod = 'download' | 'print' | 'pptx';
/**
 * 저장 기록(관리자 [통계] 탭) — **실패해도 조용히 넘긴다.** 통계 때문에 저장이 실패한 것처럼 보이면 안 된다.
 * 서버 규칙은 `backend/src/lib/exportStats.ts`.
 */
export function logExport(input: { method: ExportMethod; pages: number; works: number; uploaded?: boolean }): void {
  void api.post('/portfolio/exports', { method: input.method, pages: input.pages, works: input.works, uploaded: !!input.uploaded })
    .catch(() => { /* 기록은 덤이다 */ });
}
