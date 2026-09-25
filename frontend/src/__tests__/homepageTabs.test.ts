import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { homepageTabs, resolveHomepageTab, tabParamFor } from '@/lib/homepageTabs';
import { fileExtension, fileTypeLabel, formatBytes, pdfPageWidth, pdfRenderScale, portfolioFileKind } from '@/lib/portfolioFile';

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

  describe('쪽 폭 — 한 화면에 한 쪽, 다만 글씨가 못 읽을 만큼 작아지지 않게', () => {
    const A4P = 1 / Math.SQRT2; // A4 세로
    const A4L = Math.SQRT2;     // A4 가로
    const WIDE = 16 / 9;        // PPT

    it('휴대폰은 늘 화면 폭(컨테이너)', () => {
      for (const aspect of [A4P, A4L, WIDE]) {
        expect(pdfPageWidth({ containerWidth: 327, viewportHeight: 700, aspect })).toBe(327);
      }
    });

    it('데스크톱 가로 판형은 높이에 맞춰도 상한 1000px', () => {
      expect(pdfPageWidth({ containerWidth: 1184, viewportHeight: 900, aspect: WIDE })).toBe(1000);
      expect(pdfPageWidth({ containerWidth: 1184, viewportHeight: 900, aspect: A4L })).toBe(1000);
    });

    it('A4 세로는 높이에 맞추면 530px 쯤이라 글씨가 8px 이 된다 — 하한 640px', () => {
      expect(pdfPageWidth({ containerWidth: 1184, viewportHeight: 900, aspect: A4P })).toBe(640);
      // 아주 큰 모니터면 높이에 맞춘 값이 하한보다 크다
      expect(pdfPageWidth({ containerWidth: 1184, viewportHeight: 1400, aspect: A4P })).toBe(Math.floor((1400 - 150) * A4P));
    });

    it('컨테이너를 넘지 않는다 · 폭 0 이면 0 · 비율이 이상하면 A4 세로로 본다', () => {
      expect(pdfPageWidth({ containerWidth: 600, viewportHeight: 900, aspect: A4P })).toBe(600);
      expect(pdfPageWidth({ containerWidth: 0, viewportHeight: 900, aspect: A4P })).toBe(0);
      expect(pdfPageWidth({ containerWidth: 1184, viewportHeight: 900, aspect: NaN })).toBe(640);
    });
  });

  describe('캔버스 배율 — iOS 캔버스 메모리 상한', () => {
    it('화면 폭 × 기기 배율(최대 2)', () => {
      const s = pdfRenderScale({ cssWidth: 500, pageWidthPt: 595, pageHeightPt: 842, dpr: 2 });
      expect(s).toBeCloseTo((500 * 2) / 595, 6);
      const s3 = pdfRenderScale({ cssWidth: 500, pageWidthPt: 595, pageHeightPt: 842, dpr: 3 });
      expect(s3).toBeCloseTo(s, 6); // 3배 기기도 2배까지만
    });

    it('한 장이 800만 px 을 넘지 않는다', () => {
      const s = pdfRenderScale({ cssWidth: 1000, pageWidthPt: 595, pageHeightPt: 842, dpr: 2 });
      expect(595 * s * 842 * s).toBeLessThanOrEqual(8_000_000 + 1);
    });

    it('잘못된 입력은 0', () => {
      expect(pdfRenderScale({ cssWidth: 0, pageWidthPt: 595, pageHeightPt: 842, dpr: 2 })).toBe(0);
      expect(pdfRenderScale({ cssWidth: 500, pageWidthPt: 0, pageHeightPt: 842, dpr: 2 })).toBe(0);
    });
  });
});
