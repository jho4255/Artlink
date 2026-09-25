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
 * PDF 한 쪽을 화면에 몇 px 폭으로 놓을지.
 *
 * 포트폴리오 PDF 는 판형이 제각각이다 — PPT 에서 뽑은 16:9, A4 가로, A4 세로. 셋을 같은 규칙으로 놓는다:
 *  - **한 쪽이 한 화면에 들어오게** 높이에 맞춘다(작품 사진이 두 화면에 걸쳐 잘려 보이지 않게).
 *  - 다만 **`minWidth`(640) 밑으로는 줄이지 않는다** — A4 세로를 노트북 높이에 맞추면 폭이 530px 쯤이 되는데,
 *    그러면 약력 글씨가 8px 로 줄어 못 읽는다. 조금 넘쳐 스크롤하는 편이 낫다.
 *  - **`maxWidth`(1000) 위로도 키우지 않는다** — 넓은 화면에서 16:9 가 1180px 로 퍼지면 한눈에 안 들어온다.
 *  - 그래도 컨테이너를 넘지는 않는다(휴대폰은 늘 컨테이너 폭 = 화면 폭).
 *
 * @param aspect 쪽의 폭/높이
 */
export function pdfPageWidth({ containerWidth, viewportHeight, aspect, reserved = 150, minWidth = 640, maxWidth = 1000 }: {
  containerWidth: number; viewportHeight: number; aspect: number; reserved?: number; minWidth?: number; maxWidth?: number;
}): number {
  if (!(containerWidth > 0)) return 0;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1 / Math.SQRT2;
  const fitHeight = Math.max(0, viewportHeight - reserved) * a;
  const w = Math.min(containerWidth, maxWidth, Math.max(minWidth, fitHeight));
  return Math.floor(w);
}

/**
 * 캔버스 배율 — 화면 폭 × 기기 배율(최대 2)로 그리되, **한 장의 픽셀 수에 상한**을 둔다.
 * iOS Safari 는 캔버스 메모리가 작아(한 장 16.7M px, 전체 수백 MB) 큰 쪽을 3배로 그리면 빈 캔버스가 된다.
 * 화면에서 멀어진 쪽은 `PdfViewer` 가 비워 전체 메모리도 묶는다.
 */
export function pdfRenderScale({ cssWidth, pageWidthPt, pageHeightPt, dpr, maxPixels = 8_000_000 }: {
  cssWidth: number; pageWidthPt: number; pageHeightPt: number; dpr: number; maxPixels?: number;
}): number {
  if (!(cssWidth > 0) || !(pageWidthPt > 0) || !(pageHeightPt > 0)) return 0;
  const ratio = Math.min(Math.max(dpr || 1, 1), 2);
  let scale = (cssWidth * ratio) / pageWidthPt;
  const area = pageWidthPt * scale * pageHeightPt * scale;
  if (area > maxPixels) scale *= Math.sqrt(maxPixels / area);
  return scale;
}
