/**
 * 단체전 도록 — 순수 HTML 빌더·데이터 매핑 (2026-09-16). 렌더 결과(잘림·여백)는 하니스로 본다.
 * ⚠️ 엽서·가격표·QR 캡션 묶음은 그 기능과 함께 지웠다(2026-09-16) — 작품 캡션(.hwp)이 이미 하는 일이라서.
 */
import { describe, it, expect } from 'vitest';
import {
  periodText, representativeWork, catalogueCoverHtml, catalogueIntroHtml, catalogueBackCoverHtml,
  artistBookData, type BoothContext, type BoothRow,
} from '@/lib/boothKit';
import { buildPortfolioPages, themeById } from '@/lib/portfolioFormats';

const ctx: BoothContext = {
  exhibition: { id: 7, title: '대전 K 아트페어', typeLabel: '아트페어', period: '2026.10.1 – 10.4', description: '갤러리엠 부스입니다.', poster: null, url: 'https://artlink.cc/exhibitions/7' },
  gallery: { name: '갤러리 엠', address: '대전 서구 둔산로 100', phone: '042-111-2222', instagram: 'https://instagram.com/gallery_m', region: '대전' },
};
const work = (o: Partial<{ image: string; title: string; size: string; medium: string; year: string; price: string }> = {}) =>
  ({ image: '/uploads/w.jpg', title: '새벽의 창', size: '72.7×90.9 cm', medium: '캔버스에 유채', year: '2025', price: '3200000', ...o });
const row = (o: Partial<BoothRow['submission']> = {}, user: Partial<BoothRow['user']> = {}): BoothRow => ({
  user: { id: 1, name: '박기량', nickname: null, handle: 'kiiryang', ...user },
  submission: { artworkList: [work(), work({ image: '/uploads/w2.jpg', title: '두 번째', price: '' })], cv: null, note: null, representativeIndex: 1, ...o },
});

describe('periodText', () => {
  it('같은 해면 뒤 연도를 생략, 다른 해면 둘 다', () => {
    expect(periodText('2026-10-01T00:00:00.000Z', '2026-10-04T00:00:00.000Z')).toBe('2026.10.1 – 10.4');
    expect(periodText('2026-12-30T00:00:00.000Z', '2027-01-02T00:00:00.000Z')).toBe('2026.12.30 – 2027.1.2');
    expect(periodText(null, '2026-10-04T00:00:00.000Z')).toBe('2026.10.4');
    expect(periodText(null, null)).toBe('');
  });
});

describe('representativeWork — 작가가 고른 대표작', () => {
  it('인덱스가 있으면 그것, 없거나 벗어나면 첫 작품', () => {
    expect(representativeWork(row())!.title).toBe('두 번째');
    expect(representativeWork(row({ representativeIndex: 9 }))!.title).toBe('새벽의 창');
    expect(representativeWork(row({ representativeIndex: null }))!.title).toBe('새벽의 창');
    expect(representativeWork(row({ artworkList: [] }))).toBeNull();
  });
});

describe('도록', () => {
  it('표지 — 전시명·기간·갤러리, 대표 이미지는 자르지 않는다', () => {
    const html = catalogueCoverHtml(ctx, '/uploads/w.jpg');
    expect(html).toContain('대전 K 아트페어');
    expect(html).toContain('아트페어 · 2026.10.1 – 10.4');
    expect(html).toContain('갤러리 엠');
    expect(html).toContain('max-width:100%;max-height:100%');
    expect(html).not.toContain('object-fit:cover');
  });
  it('뒷표지 — 갤러리 연락처(인스타는 프로토콜 없이)', () => {
    const html = catalogueBackCoverHtml(ctx);
    expect(html).toContain('대전 서구 둔산로 100');
    expect(html).toContain('042-111-2222');
    expect(html).toContain('instagram.com/gallery_m');
    expect(html).not.toContain('https://instagram.com/gallery_m');
  });
  it('소개 장 — 차례에 시작 쪽, 긴 소개는 자른다', () => {
    const html = catalogueIntroHtml({ ...ctx, exhibition: { ...ctx.exhibition, description: '소'.repeat(2000) } }, [{ name: '박기량', page: 3 }, { name: '마은영', page: 9 }]);
    expect(html).toContain('박기량');
    expect(html).toMatch(/>3<\/span>/);
    expect(html).toMatch(/>9<\/span>/);
    expect(html).toContain('소'.repeat(1100) + '…');
  });
  it('artistBookData — 제출자료를 엔진 입력으로, 대표작 id, 빈 이미지는 뺀다', () => {
    const r = row({ artworkList: [work(), work({ image: '' }), work({ image: '/uploads/w3.jpg', title: '셋' })], representativeIndex: 2,
      cv: { nameKo: '박기량', nameEn: 'Park', birth: '1990, Suncheon', tel: '010', email: 'a@b.c', education: [{ year: '2015', content: '전남대' }], solo: [], group: [{ year: '', content: '' }], artFair: [], award: [] } });
    const { data, repId } = artistBookData(r);
    expect(data.images.map((i) => i.url)).toEqual(['/uploads/w.jpg', '/uploads/w3.jpg']);
    expect(repId).toBe(3);                     // order 2 → id 3 (빈 이미지를 빼도 id 는 원래 순번)
    expect(data.career?.education).toEqual([{ year: '2015', content: '전남대' }]);
    expect(data.career?.group).toEqual([]);   // 빈 항목은 뺀다
    expect(data.user.name).toBe('박기량');
    expect(data.biography).toBe('1990, Suncheon');
  });
  it('엔진 — folioStart 로 쪽번호가 이어지고 skipContact 로 연락처 장이 빠진다', () => {
    const { data } = artistBookData(row());
    const pages = buildPortfolioPages(data, themeById('archive'), { forPdf: true, design: { page: 'a5-portrait' }, folioStart: 7, skipContact: true });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.some((p) => p.kind === 'contact')).toBe(false);
    expect(pages.some((p) => p.html.includes('<!--FOLIO-->'))).toBe(false);
    // 두 번째 장(작품)의 쪽번호가 8 — 표지가 7
    expect(pages[1]!.html).toMatch(/>\s*8\s*</);
  });
});
