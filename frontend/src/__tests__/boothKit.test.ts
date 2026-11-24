/**
 * 단체전 도록 (2026-09-16 · 2026-11-24 전용 조판으로 다시 짬, 규칙 53·92).
 *
 * 예전 도록은 포트폴리오 엔진을 작가마다 그대로 불러 이어 붙여 10명에 105쪽 · 거의 빈 쪽 17쪽 · 여러 점 쪽의 캡션 잘림이 났다.
 * 이제 쪽 계획(`planCatalogue`)이 순수 함수라 **가짜 잣대**로 규칙을 확인한다 — 작가마다 짝수 쪽(왼쪽에서 시작) · 전체 4의 배수 ·
 * 작품은 비율 그대로 · 작가노트는 자르지 않는다. 실제 글꼴로 잰 결과는 브라우저 하니스(scratchpad/output-audit-2026-11)로 본다.
 */
import { describe, it, expect } from 'vitest';
import {
  BOX, MIN_AREA, MIN_SIDE, ST, artistPageHtml, captionHtml, catalogueBackCoverHtml, catalogueContentsHtml, catalogueCoverHtml,
  catalogueIntroHtml, cvSummary, layoutWorks, parasHtml, periodText, planArtist, planCatalogue, representativeWork,
  type ArtistPage, type BoothContext, type BoothRow, type CatArtist, type CatWork, type Measure,
} from '@/lib/boothKit';

const ctx: BoothContext = {
  exhibition: { id: 7, title: '대전 K 아트페어', typeLabel: '아트페어', period: '2026.10.1 – 10.4', description: '갤러리엠 부스입니다.', poster: null, url: 'https://artlink.cc/exhibitions/7' },
  gallery: { name: '갤러리 엠', address: '대전 서구 둔산로 100', phone: '042-111-2222', instagram: 'https://instagram.com/gallery_m', region: '대전' },
};
const work = (o: Partial<{ image: string; title: string; size: string; medium: string; year: string; price: string }> = {}) =>
  ({ image: '/uploads/w.jpg', title: '새벽의 창', size: '72.7×90.9 cm', medium: '캔버스에 유채', year: '2025', price: '3200000', ...o });
const row = (o: Partial<BoothRow['submission']> = {}): BoothRow => ({
  user: { id: 1, name: '박기량', nickname: null, handle: 'kiiryang' },
  submission: { artworkList: [work(), work({ image: '/uploads/w2.jpg', title: '두 번째' })], cv: null, note: null, representativeIndex: 1, ...o },
});

// ── 가짜 잣대: 작가노트 한 줄 32px(작은 판 27px) · 한 줄 36자 · 이름 150 · 캡션 44(좁으면 66) · 약력 요약 120 ──
const CPL = 36;
const lineOf = (small: boolean) => (small ? 27 : 32);
const paraH = (ps: string[], small: boolean) => ps.reduce((s, p, i) => s + Math.ceil(p.length / CPL) * lineOf(small) + (i ? 13 : 0), 0);
const fake: Measure = {
  height(html, w) {
    if (html.includes('border-top:1px solid #111')) return 120;
    if (html.includes(ST.name)) return 150;
    if (html.includes(ST.capTitle)) return w < 200 ? 66 : 44;
    const small = html.includes(ST.statementSm);
    const ps = [...html.matchAll(/<p [^>]*>(.*?)<\/p>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ''));
    return paraH(ps, small);
  },
  fitParas(paras, _w, h, small = false) {
    const taken: string[] = [];
    for (let i = 0; i < paras.length; i++) {
      if (paraH([...taken, paras[i]!], small) <= h) { taken.push(paras[i]!); continue; }
      const room = h - paraH(taken, small) - (taken.length ? 13 : 0);
      const lines = Math.floor(room / lineOf(small));
      if (lines > 0) return { taken: [...taken, paras[i]!.slice(0, lines * CPL)], rest: [paras[i]!.slice(lines * CPL), ...paras.slice(i + 1)], split: true };
      return { taken, rest: paras.slice(i), split: false };
    }
    return { taken, rest: [], split: false };
  },
};

const cw = (aspect: number, title = '작품'): CatWork => ({ url: `/uploads/${title}.jpg`, aspect, title, year: '2026', medium: 'Oil on canvas', size: '72.7 × 60.6 cm' });
const artist = (o: Partial<CatArtist> = {}): CatArtist => ({
  name: '강윤서', nameEn: '', rep: cw(1.3, '대표작'),
  works: [cw(1, 'a'), cw(0.8, 'b'), cw(1.4, 'c'), cw(0.75, 'd'), cw(1, 'e')],
  statement: ['가'.repeat(300), '나'.repeat(200)],
  cv: [{ label: '개인전', text: '2026 개인전 「사이」' }],
  ...o,
});
const worksOf = (pages: ArtistPage[]) => pages.flatMap((p) => (p.kind === 'works' ? p.works.map((w) => w.title) : []));

describe('periodText · representativeWork', () => {
  it('같은 해면 뒤 연도를 생략, 다른 해면 둘 다', () => {
    expect(periodText('2026-10-01', '2026-10-04')).toBe('2026.10.1 – 10.4');
    expect(periodText('2026-12-28', '2027-01-03')).toBe('2026.12.28 – 2027.1.3');
    expect(periodText('2026-10-01', null)).toBe('2026.10.1');
    expect(periodText(null, null)).toBe('');
  });
  it('작가가 고른 대표작, 없거나 벗어나면 첫 작품', () => {
    expect(representativeWork(row())?.title).toBe('두 번째');
    expect(representativeWork(row({ representativeIndex: 9 }))?.title).toBe('새벽의 창');
    expect(representativeWork(row({ artworkList: [] }))).toBeNull();
  });
});

describe('작품 배치 — 자르지도 늘리지도 않는다(규칙 18)', () => {
  it('그림은 제 비율 그대로 · 상자 안 · 캡션 자리까지 들어간다', () => {
    const ws = [{ aspect: 1.5 }, { aspect: 0.75 }, { aspect: 1 }];
    const lay = layoutWorks(ws, BOX.w, BOX.h, () => 44)!;
    expect(lay).not.toBeNull();
    expect(lay.height).toBeLessThanOrEqual(BOX.h + 0.5);
    for (const it of lay.items) {
      expect(it.w / it.h).toBeCloseTo(ws[it.index]!.aspect, 6);
      expect(it.x).toBeGreaterThanOrEqual(-0.01);
      expect(it.x + it.w).toBeLessThanOrEqual(BOX.w + 0.01);
      expect(it.capY + it.capH).toBeLessThanOrEqual(BOX.h + 0.5);
    }
  });
  it('그림 하나라도 하한(짧은 변·넓이) 아래면 그 배치는 없다 — 다른 쪽으로 나눠야 한다', () => {
    const panoramas = [{ aspect: 4 }, { aspect: 4 }, { aspect: 4 }, { aspect: 4 }];
    expect(layoutWorks(panoramas, BOX.w, BOX.h, () => 44, MIN_SIDE, MIN_AREA)).toBeNull();
    expect(layoutWorks([{ aspect: 4 }], BOX.w, BOX.h, () => 44)).not.toBeNull();   // 한 점은 늘 놓인다
  });
});

describe('작가 한 사람의 쪽 — 늘 짝수(다음 작가가 왼쪽에서 시작)', () => {
  it('[대표작 | 이름 + 작가노트] → 작품 · 작품은 한 번씩 순서대로 · 약력 요약은 마지막 작품 쪽 아래', () => {
    const pages = planArtist(artist(), fake);
    expect(pages.length % 2).toBe(0);
    expect(pages[0]).toMatchObject({ kind: 'rep' });
    expect(pages[1]).toMatchObject({ kind: 'name' });
    expect(worksOf(pages)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const last = pages[pages.length - 1]!;
    expect(last.kind === 'works' && last.cv).toBe(true);
    for (const p of pages) if (p.kind === 'works') expect(p.works.length).toBeLessThanOrEqual(4);
  });

  it('작가노트가 없으면 약력 요약을 이름 아래에(이름 쪽이 비지 않게)', () => {
    const pages = planArtist(artist({ statement: [] }), fake);
    expect(pages[1]).toMatchObject({ kind: 'name', cv: true });
    expect(pages.some((p) => p.kind === 'works' && p.cv)).toBe(false);
    expect(pages.length % 2).toBe(0);
  });

  it('긴 작가노트는 다음 쪽으로 잇는다 — 한 글자도 잃지 않는다', () => {
    const statement = Array.from({ length: 12 }, (_, i) => String.fromCharCode(0xac00 + i).repeat(260));
    const pages = planArtist(artist({ statement }), fake);
    const text = pages.flatMap((p) => (p.kind === 'name' || p.kind === 'text' ? p.paras : [])).join('');
    expect(text).toBe(statement.join(''));
    expect(pages.filter((p) => p.kind === 'text').length).toBeGreaterThan(0);
    expect(pages.length % 2).toBe(0);
  });

  it('몇 줄만 넘치면 그 작가의 작가노트만 한 단계 작게 — 쪽이 하나 줄 때만', () => {
    // 이름 쪽(864 − 150 = 714px)에 보통 글자 22줄 = 704px. 23줄이면 한 줄이 다음 쪽으로 넘친다
    const pages = planArtist(artist({ statement: ['가'.repeat(CPL * 23)] }), fake);
    expect(pages[1]).toMatchObject({ kind: 'name', small: true });
    expect(pages.some((p) => p.kind === 'text')).toBe(false);
    // 많이 넘치면 줄이지 않는다
    const long = planArtist(artist({ statement: ['가'.repeat(CPL * 40)] }), fake);
    expect(long[1]).toMatchObject({ kind: 'name', small: false });
  });

  it('작품이 대표작 하나뿐이어도 짝수 — [대표작 | 이름]', () => {
    const pages = planArtist(artist({ works: [], cv: [] }), fake);
    expect(pages.map((p) => p.kind)).toEqual(['rep', 'name']);
  });
});

describe('도록 전체', () => {
  const artists = [artist(), artist({ name: '노해원', statement: [] }), artist({ name: '문지호', works: [cw(1, 'x')] })];
  const plan = planCatalogue(artists, fake);

  it('표지 · 전시 소개 · 참여 작가 → 작가들 → 뒷표지 · 전체 쪽 수는 4의 배수', () => {
    expect(plan.pages.slice(0, 3)).toEqual([{ front: 'cover' }, { front: 'intro' }, { front: 'contents' }]);
    expect(plan.pages[plan.pages.length - 1]).toEqual({ front: 'back' });
    expect(plan.pages.length % 4).toBe(0);
  });

  it('작가마다 왼쪽(짝수) 쪽에서 시작하고, 차례의 쪽 번호가 그 쪽이다', () => {
    expect(plan.index.map((i) => i.name)).toEqual(['강윤서', '노해원', '문지호']);
    for (const [k, it] of plan.index.entries()) {
      expect(it.page % 2).toBe(0);
      const p = plan.pages[it.page - 1]!;
      expect('artist' in p && p.artist).toBe(k);
    }
  });

  it('쪽 HTML — 머리말은 왼쪽 쪽에 전시명, 오른쪽 쪽에 작가 이름 · 그림은 잰 크기 그대로', () => {
    const a = artists[0]!;
    const pages = planArtist(a, fake);
    const rep = artistPageHtml(pages[0]!, a, 4, '대전 K 아트페어', fake);
    expect(rep).toContain('대전 K 아트페어');
    expect(rep).not.toContain('>강윤서<');
    const m = /width="(\d+)" height="(\d+)"/.exec(rep)!;
    expect(Number(m[1]) / Number(m[2])).toBeCloseTo(1.3, 1);
    expect(rep).not.toContain('object-fit:cover');
    const name = artistPageHtml(pages[1]!, a, 5, '대전 K 아트페어', fake);
    expect(name).toContain('>강윤서<');
  });
});

describe('글 · 캡션 · 약력 요약', () => {
  it('작가노트 — 쪽 끝에서 나뉜 맨 끝 줄만 양쪽 맞춤(작가가 친 줄바꿈 앞 줄은 맞추지 않는다)', () => {
    const html = parasHtml(['첫 문단', '둘째\n셋째 줄'], true);
    expect(html.match(/text-align-last:justify/g)).toHaveLength(1);
    expect(html).toMatch(/text-align-last:justify">셋째 줄</);
    expect(parasHtml(['둘째\n셋째 줄'])).not.toContain('text-align-last');
    expect(parasHtml(['<b>'])).toContain('&lt;b&gt;');
    expect(parasHtml(['가'], false, true)).toContain(ST.statementSm);
  });

  it('캡션 — 작품명, 연도 / 재료 · 크기 · 제목이 없으면 무제', () => {
    const html = captionHtml({ title: '푸른 벽', year: '2026', medium: 'Acrylic on canvas', size: '116.8 × 91.0 cm' });
    expect(html).toContain('푸른 벽, 2026');
    expect(html).toContain('Acrylic on canvas · 116.8 × 91.0 cm');
    expect(captionHtml({ title: '', year: '', medium: '', size: '' })).toContain('무제');
  });

  it('약력 요약 — 갈래마다 최근 둘 + 외 N회(학력은 외 N) · 빈 갈래는 빠진다', () => {
    const rows = cvSummary({
      education: [{ year: '2015', content: '전남대' }, { year: '2018', content: '대학원' }, { year: '2010', content: '고교' }],
      solo: [{ year: '2024', content: 'A' }, { year: '2026', content: 'B' }, { year: '2025', content: 'C' }, { year: '2020', content: 'D' }],
      group: [{ year: '', content: '' }],
      award: [{ year: '2026', content: '신진작가상' }],
    });
    expect(rows).toEqual([
      { label: '학력', text: '2018 대학원 · 2015 전남대 외 1' },
      { label: '개인전', text: '2026 B · 2025 C 외 2회' },
      { label: '수상', text: '2026 신진작가상' },
    ]);
    expect(cvSummary(null)).toEqual([]);
  });
});

describe('표지 · 소개 · 차례 · 뒷표지', () => {
  it('표지 — 전시명·기간·갤러리, 대표 이미지는 자르지 않는다', () => {
    const html = catalogueCoverHtml(ctx, '/uploads/p.jpg');
    for (const s of ['대전 K 아트페어', '아트페어 · 2026.10.1 – 10.4', '갤러리 엠']) expect(html).toContain(s);
    expect(html).toContain('max-width:100%;max-height:100%');
    expect(html).not.toContain('object-fit:cover');
  });
  it('전시 소개 — 긴 소개는 자르고, 차례는 이름과 시작 쪽', () => {
    const long = catalogueIntroHtml({ ...ctx, exhibition: { ...ctx.exhibition, description: '소'.repeat(2000) } });
    expect(long).toContain('소'.repeat(1400) + '…');
    const contents = catalogueContentsHtml([{ name: '강윤서', page: 4 }, { name: '노해원', page: 10 }]);
    expect(contents).toContain('참여 작가 2');
    expect(contents).toMatch(/강윤서[\s\S]*>4<\/span>/);
    expect(contents).toMatch(/노해원[\s\S]*>10<\/span>/);
  });
  it('뒷표지 — 갤러리 연락처(인스타는 프로토콜 없이)', () => {
    const html = catalogueBackCoverHtml(ctx);
    for (const s of ['갤러리 엠', '대전 서구 둔산로 100', '042-111-2222', 'instagram.com/gallery_m']) expect(html).toContain(s);
    expect(html).not.toContain('https://instagram.com');
  });
});
