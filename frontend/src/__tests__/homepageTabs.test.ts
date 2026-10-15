import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { homepageTabs, resolveHomepageTab, tabParamFor } from '@/lib/homepageTabs';
import {
  PDF_MAX_PIXELS, PDF_ZOOM_MAX_PIXELS, fileExtension, fileTypeLabel, formatBytes, pagesInView, pdfCanvasSize, pdfPageBox, pdfPageWidth, pdfRenderScale, pdfZoomStep, portfolioFileKind, ratioFraction,
} from '@/lib/portfolioFile';

const full = { workCount: 12, hasNote: true, hasCv: true, hasFile: true, guestbook: { count: 3 } };

describe('작가 홈페이지 탭 (lib/homepageTabs)', () => {
  it('순서는 작품 → 작가노트 → 약력 → 포트폴리오 → 방명록, 작품·방명록엔 개수', () => {
    const tabs = homepageTabs(full);
    expect(tabs.map((t) => t.label)).toEqual(['작품', '작가노트', '약력', '포트폴리오', '방명록']);
    expect(tabs[0]!.count).toBe(12);
    expect(tabs[4]!.count).toBe(3);
  });

  it('비어 있는 탭은 만들지 않는다 — 눌렀는데 아무것도 없으면 고장처럼 보인다', () => {
    const tabs = homepageTabs({ workCount: 0, hasNote: false, hasCv: true, hasFile: false, guestbook: { count: 0 } });
    expect(tabs.map((t) => t.id)).toEqual(['cv', 'guestbook']);
  });

  it('방명록은 글이 0개여도 탭이 있다(글을 쓰러 가는 곳) — 다만 0 은 적지 않는다', () => {
    const gb = homepageTabs({ ...full, guestbook: { count: 0 } }).find((t) => t.id === 'guestbook');
    expect(gb).toBeTruthy();
    expect(gb!.count).toBeUndefined();
  });

  it('편집 미리보기(방명록 없음)에는 방명록 탭이 없다', () => {
    expect(homepageTabs({ ...full, guestbook: null }).some((t) => t.id === 'guestbook')).toBe(false);
  });

  it('모르는 값·지금 없는 탭은 첫 탭으로 — 작가가 파일을 지운 뒤에도 옛 ?tab=file 링크가 돈다', () => {
    const tabs = homepageTabs({ ...full, hasFile: false });
    expect(resolveHomepageTab('file', tabs)).toBe('works');
    expect(resolveHomepageTab('<script>', tabs)).toBe('works');
    expect(resolveHomepageTab(null, tabs)).toBe('works');
    expect(resolveHomepageTab('guestbook', tabs)).toBe('guestbook');
    expect(resolveHomepageTab('x', [])).toBeNull();
  });

  it('주소에는 첫 탭을 싣지 않는다(공유 주소를 깔끔하게), 나머지는 id', () => {
    const tabs = homepageTabs(full);
    expect(tabParamFor('works', tabs)).toBeNull();
    expect(tabParamFor('file', tabs)).toBe('file');
    // 작품이 없는 작가는 작가노트가 첫 탭이다
    const noWorks = homepageTabs({ ...full, workCount: 0 });
    expect(tabParamFor('note', noWorks)).toBeNull();
  });

  it('방명록 알림은 방명록 탭으로 보낸다 — 쿼리가 없으면 [작품] 탭이 열려 글이 안 보인다', () => {
    const src = readFileSync(resolve(__dirname, '../../../backend/src/routes/guestbook.ts'), 'utf8');
    const links = src.match(/linkUrl: `[^`]+`/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) expect(l).toContain('?tab=guestbook');
  });
});

describe('포트폴리오 파일 (lib/portfolioFile)', () => {
  it('확장자는 쿼리·해시를 떼고 소문자로', () => {
    expect(fileExtension('https://img.artlink.cc/artlink/files/1-2.PDF?v=3')).toBe('pdf');
    expect(fileExtension('/uploads/1758000000-12.hwp#x')).toBe('hwp');
    expect(fileExtension('/uploads/noext')).toBeNull();
    expect(fileExtension('/uploads/.hidden')).toBeNull();
    expect(fileExtension(null)).toBeNull();
  });

  it('페이지 안에서 펼치는 건 PDF 뿐', () => {
    expect(portfolioFileKind('/uploads/a.pdf')).toBe('pdf');
    expect(portfolioFileKind('/uploads/a.hwp')).toBe('other');
    expect(portfolioFileKind('/uploads/a.docx')).toBe('other');
    expect(portfolioFileKind('/uploads/a.zip')).toBe('other');
    expect(portfolioFileKind(null)).toBeNull();
    expect(fileTypeLabel('/uploads/a.hwpx')).toBe('한글(HWP) 문서');
    expect(fileTypeLabel('/uploads/a.docx')).toBe('워드 문서');
  });

  it('용량 표기', () => {
    expect(formatBytes(8.4 * 1024 * 1024)).toBe('8.4MB');
    expect(formatBytes(730 * 1024)).toBe('730KB');
    expect(formatBytes(10)).toBe('1KB');
    expect(formatBytes(0)).toBe('0KB');
  });

  describe('쪽 폭 — 컨테이너에 맞추되 글자가 사이트 본문보다 커지지는 않게', () => {
    const A4P = 595, A4L = 842, WIDE = 960; // pt — A4 세로·가로, PPT 16:9

    it('휴대폰은 늘 화면 폭(컨테이너)', () => {
      for (const pt of [A4P, A4L, WIDE]) expect(pdfPageWidth({ containerWidth: 327, pageWidthPt: pt })).toBe(327);
    });

    it('★ PC 의 A4 세로는 1000px — 2026-10-15 까지 높이에 맞춰 640px 이라 10pt 본문이 7px 로 뭉개졌다', () => {
      expect(pdfPageWidth({ containerWidth: 1184, pageWidthPt: A4P })).toBe(1000);
      // 10pt 본문의 화면 크기 ≈ 17px (사이트 본문 16px 과 비슷)
      expect(10 * (1000 / A4P)).toBeGreaterThan(16);
    });

    it('가로 판형은 같은 글자 크기에서 더 넓다 — 컨테이너까지 쓴다', () => {
      expect(pdfPageWidth({ containerWidth: 1184, pageWidthPt: A4L })).toBe(1184);
      expect(pdfPageWidth({ containerWidth: 1184, pageWidthPt: WIDE })).toBe(1184);
      // 작은 판형(명함 크기 등)은 늘리지 않는다
      expect(pdfPageWidth({ containerWidth: 1184, pageWidthPt: 300 })).toBe(Math.floor(300 * (1000 / 595)));
    });

    it('컨테이너를 넘지 않는다 · 폭 0 이면 0 · 폭을 모르면 A4 세로로 본다', () => {
      expect(pdfPageWidth({ containerWidth: 600, pageWidthPt: A4P })).toBe(600);
      expect(pdfPageWidth({ containerWidth: 0, pageWidthPt: A4P })).toBe(0);
      expect(pdfPageWidth({ containerWidth: 1184, pageWidthPt: NaN })).toBe(1000);
    });
  });

  describe('★ 상자와 캔버스는 정확히 배율만큼 — 1px 만 어긋나도 쪽 전체가 보간돼 흐려진다(2026-10-15)', () => {
    it('배율을 작은 분수로', () => {
      expect(ratioFraction(1)).toEqual([1, 1]);
      expect(ratioFraction(2)).toEqual([2, 1]);
      expect(ratioFraction(1.25)).toEqual([5, 4]);
      expect(ratioFraction(1.5)).toEqual([3, 2]);
      expect(ratioFraction(1.75)).toEqual([7, 4]);
      expect(ratioFraction(1.100000023841858)).toEqual([11, 10]);   // 크롬이 110% 를 이렇게 알려 준다
      expect(ratioFraction(2.625)).toEqual([21, 8]);
    });

    it('흔한 배율·폭 전부에서 상자 × 배율이 정수이고, 캔버스가 그 값과 같다', () => {
      for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.625, 3]) {
        for (const cssWidth of [327, 340, 360, 599, 640, 999, 1000, 1182]) {
          for (const [pw, ph] of [[595, 842], [842, 595], [960, 540], [612, 792]] as const) {
            const box = pdfPageBox({ cssWidth, pageWidthPt: pw, pageHeightPt: ph, dpr });
            expect(box.w).toBeLessThanOrEqual(cssWidth);
            expect(cssWidth - box.w).toBeLessThan(10);                       // 분모만큼만 줄어든다
            expect(Number.isInteger(box.w * ratioFraction(dpr)[0] / ratioFraction(dpr)[1])).toBe(true);
            expect(Math.abs(box.h - (box.w * ph) / pw)).toBeLessThanOrEqual(ratioFraction(dpr)[1] / 2 + 0.5);   // 비율은 그대로(분모의 절반 px 안)
            const px = pdfCanvasSize(box, { w: pw, h: ph }, dpr);
            if (px.w * px.h < PDF_MAX_PIXELS * 0.99) {
              expect(px.w).toBe(Math.round(box.w * dpr));
              expect(Math.abs(px.w - box.w * dpr)).toBeLessThan(0.02);
              expect(Math.abs(px.h - box.h * dpr)).toBeLessThan(0.02);
            }
          }
        }
      }
    });

    it('옛 방식의 사고를 다시 내지 않는다 — 높이는 상자를 기준으로(반올림 1414 ↔ 내림 1413 이 아니라)', () => {
      const box = pdfPageBox({ cssWidth: 999, pageWidthPt: 595.28, pageHeightPt: 841.89, dpr: 1 });
      const px = pdfCanvasSize(box, { w: 595.28, h: 841.89 }, 1);
      expect(px.h).toBe(box.h);
    });

    it('뷰어가 이 둘을 쓰고, 캔버스를 기기 픽셀 경계에 맞춘다(소스)', () => {
      const src = readFileSync(resolve(__dirname, '../components/shared/PdfViewer.tsx'), 'utf-8');
      expect(src).toMatch(/pdfPageBox\(/);
      expect(src).toMatch(/pdfCanvasSize\(/);
      expect(src).toMatch(/translate\(\$\{dx \/ d\}px, \$\{dy \/ d\}px\)/);
      // 옛 방식(내림으로 캔버스 크기 정하기)으로 되돌리지 않는다
      expect(src).not.toMatch(/Math\.floor\(vp\.(width|height)\)/);
    });
  });

  describe('캔버스 배율 — 화면 해상도 그대로 · iOS 캔버스 메모리 상한', () => {
    it('★ 화면 폭 × 기기 배율(최대 3) — 2026-10-15 까지 2로 묶여 3배 휴대폰에서 1.5배 늘려 보였다', () => {
      const s2 = pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 2 });
      expect(s2).toBeCloseTo((340 * 2) / 595, 6);
      const s3 = pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 3 });
      expect(s3).toBeCloseTo((340 * 3) / 595, 6);   // 아이폰 13: 340px 칸에 1020px 그림
      const s4 = pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 4 });
      expect(s4).toBeCloseTo(s3, 6);                // 3배 넘는 화면도 3배까지
      expect(pdfRenderScale({ cssWidth: 640, pageWidthPt: 595, pageHeightPt: 842, dpr: 1.25 })).toBeCloseTo((640 * 1.25) / 595, 6);
    });

    it('평소 한 장은 800만 px 을 넘지 않는다', () => {
      const s = pdfRenderScale({ cssWidth: 1000, pageWidthPt: 595, pageHeightPt: 842, dpr: 3 });
      expect(595 * s * 842 * s).toBeLessThanOrEqual(PDF_MAX_PIXELS + 1);
    });

    it('★ 확대하면 그 배율만큼 더 크게 — 확대 중 한 장은 1200만 px 까지(iOS 한 장 상한 16.7M 아래)', () => {
      const base = pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 3 });
      const z2 = pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 3, zoom: 2 });
      expect(z2).toBeCloseTo(base * 2, 6);           // 2040×2887 = 5.9M px — 상한 안
      const z4 = pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 3, zoom: 4 });
      expect(595 * z4 * 842 * z4).toBeLessThanOrEqual(PDF_ZOOM_MAX_PIXELS + 1);
      expect(PDF_ZOOM_MAX_PIXELS).toBeLessThan(4096 * 4096);
      expect(pdfRenderScale({ cssWidth: 340, pageWidthPt: 595, pageHeightPt: 842, dpr: 3, zoom: 0.5 })).toBeCloseTo(base, 6);   // 줄여 봐도 평소대로
    });

    it('확대 배율은 계단으로 — 손가락을 조금 움직일 때마다 다시 그리지 않는다', () => {
      expect(pdfZoomStep(1)).toBe(1);
      expect(pdfZoomStep(1.08)).toBe(1);
      expect(pdfZoomStep(1.2)).toBe(1.5);
      expect(pdfZoomStep(1.5)).toBe(1.5);
      expect(pdfZoomStep(1.6)).toBe(2);
      expect(pdfZoomStep(2.4)).toBe(3);
      expect(pdfZoomStep(3.5)).toBe(4);
      expect(pdfZoomStep(8)).toBe(4);
      expect(pdfZoomStep(NaN)).toBe(1);
    });

    it('확대 중 다시 그릴 쪽 — 보이는 영역과 겹치는 쪽, 많이 겹치는 순으로 둘까지 · 못 찾으면 가운데에 가까운 쪽', () => {
      const page = (n: number, top: number) => ({ n, r: { top, bottom: top + 500, left: 20, right: 360 } });
      const pages = [page(1, 0), page(2, 520), page(3, 1040), page(4, 1560)];
      // 확대해서 2쪽 아래쪽과 3쪽 위쪽을 보는 중
      expect(pagesInView(pages, { top: 900, left: 100, width: 130, height: 300 })).toEqual([3, 2]);
      expect(pagesInView(pages, { top: 600, left: 100, width: 130, height: 200 })).toEqual([2]);
      expect(pagesInView(pages, { top: 600, left: 100, width: 130, height: 2000 }, 2)).toHaveLength(2);
      // 좌표가 어긋나 아무것도 안 겹치면 가운데에 가장 가까운 쪽 하나
      expect(pagesInView(pages, { top: 2600, left: 0, width: 100, height: 100 })).toEqual([4]);
      expect(pagesInView([], { top: 0, left: 0, width: 100, height: 100 })).toEqual([]);
    });

    it('잘못된 입력은 0', () => {
      expect(pdfRenderScale({ cssWidth: 0, pageWidthPt: 595, pageHeightPt: 842, dpr: 2 })).toBe(0);
      expect(pdfRenderScale({ cssWidth: 500, pageWidthPt: 0, pageHeightPt: 842, dpr: 2 })).toBe(0);
    });
  });

  it('뷰어는 확대·기기 배율이 바뀌면 다시 그리고, 다 그린 뒤에 바꿔 끼운다(소스)', () => {
    const src = readFileSync(join(__dirname, '..', 'components/shared/PdfViewer.tsx'), 'utf-8');
    expect(src).toMatch(/visualViewport/);
    expect(src).toMatch(/matchMedia\(`\(resolution:/);
    // 렌더 effect 가 dpr·zoom 에 반응한다
    expect(src).toMatch(/\[near, boxW, boxH, dpr, zoom, doc, pageNo, size\]/);
    // 같은 캔버스에 다시 그리지 않는다 — 새 캔버스에 그린 뒤 replaceChildren
    expect(src).toMatch(/replaceChildren\(next\)/);
    // 2배 상한으로 되돌리지 않는다
    expect(readFileSync(join(__dirname, '..', 'lib/portfolioFile.ts'), 'utf-8')).not.toMatch(/Math\.max\(dpr \|\| 1, 1\), 2\)/);
  });
});
