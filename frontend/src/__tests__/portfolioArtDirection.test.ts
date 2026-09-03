/**
 * 아트디렉션 층 — 작품 분석 · 디자인 방향 · 페이지 전략.
 *
 * 렌더 결과(그림)는 브라우저 하니스가 재고(`scratchpad/pf/`, `qa.mjs`), 여기서는
 * **순수 함수의 계약**을 잠근다: 무엇이 몇 장 나오는가 · 어떤 배치를 고르는가 ·
 * 추천이 결정적인가 · 방향의 색이 읽히는가.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAspect, parseAreaCm2, orientationOf, artworkFacts, analyzePortfolio,
} from '../lib/artworkAnalysis';
import { DESIGN_DIRECTIONS, recommendDirections, directionByKey } from '../lib/portfolioDirection';
import { contrast, BACKGROUNDS, TEXTS, ACCENTS } from '../lib/portfolioColors';
import {
  balancedSplit, planWorkPages, buildPortfolioPages, normalizePdfDesign, themeById, WORKS_PER_PAGE,
  type PortfolioBookData,
} from '../lib/portfolioFormats';
import type { PortfolioImage } from '../types';

const img = (p: Partial<PortfolioImage>): PortfolioImage =>
  ({ id: p.id ?? Math.random(), url: p.url ?? `https://x/${p.id ?? 0}.jpg`, order: 0, ...p }) as PortfolioImage;
const works = (n: number, p: Partial<PortfolioImage> = {}) =>
  Array.from({ length: n }, (_, i) => img({ id: i + 1, series: 'S', ...p }));

describe('작품 분석 — 비율', () => {
  it('실치수에서 비율·면적을 읽는다', () => {
    expect(parseAspect('72.7×90.9 cm')).toBeCloseTo(0.8, 2);
    expect(parseAspect('116.8 x 57.0 cm')).toBeCloseTo(2.05, 2);
    expect(parseAreaCm2('100×80 cm')).toBe(8000);
  });

  it('못 읽거나 말이 안 되는 값은 null (오타를 배치 근거로 삼지 않는다)', () => {
    expect(parseAspect('대략 100호')).toBeNull();
    expect(parseAspect('1000×1 cm')).toBeNull(); // 비율 1000 — 파노라마도 이렇지 않다
    expect(parseAspect(null)).toBeNull();
  });

  it('방향 판정 — 정사각은 ±8% 폭', () => {
    expect(orientationOf(0.8)).toBe('portrait');
    expect(orientationOf(1.0)).toBe('square');
    expect(orientationOf(1.05)).toBe('square');
    expect(orientationOf(1.5)).toBe('landscape');
  });

  it('⚠️ 배치 비율은 **사진 실측이 실치수보다 우선**한다 (지면에 놓이는 건 사진이라 안 그러면 회색 여백이 생긴다)', () => {
    const a = img({ url: 'u', sizeText: '100×100 cm' });
    expect(artworkFacts(a).aspect).toBe(1);                       // 실측 없으면 실치수
    expect(artworkFacts(a, { u: 1.5 }).aspect).toBe(1.5);         // 실측이 있으면 실측
    expect(artworkFacts(a, { u: 1.5 }).aspectFrom).toBe('image');
    expect(artworkFacts(a).areaCm2).toBe(10000);                  // 면적(위계)은 실치수 그대로
  });

  it('비율을 하나도 모르면 전부 정사각으로 본다 (옛 동작 = 안전한 폴백)', () => {
    const c = analyzePortfolio({ images: works(4) });
    expect(c.mix.square).toBe(1);
    expect(c.aspectKnown).toBe(0);
  });

  it('포트폴리오 성격을 집계한다', () => {
    const c = analyzePortfolio({
      images: [
        img({ id: 1, sizeText: '50×100 cm', title: '가', description: '설명입니다'.repeat(6) }),
        img({ id: 2, sizeText: '100×50 cm' }),
        img({ id: 3, sizeText: '80×80 cm', title: '나' }),
      ],
      statement: '작가노트', biography: '', careerCount: 0,
    });
    expect(c.works).toBe(3);
    expect(c.mix.portrait).toBeCloseTo(1 / 3, 2);
    expect(c.mix.landscape).toBeCloseTo(1 / 3, 2);
    expect(c.captioned).toBeCloseTo(1, 2);   // 셋 다 제목 또는 크기가 있다
    expect(c.described).toBeCloseTo(1 / 3, 2);
    expect(c.hasStatement).toBe(true);
    expect(c.hasBiography).toBe(false);
    expect(c.aspectSpread).toBeGreaterThan(0);
  });
});

describe('디자인 방향', () => {
  it('⚠️ 모든 방향의 글자색·강조색이 배경 대비 4.5:1 을 넘는다 (추천이 곧 약속이다)', () => {
    const hex = (list: typeof BACKGROUNDS, k: string) => list.find((s) => s.key === k)?.hex;
    for (const d of DESIGN_DIRECTIONS) {
      const bg = hex(BACKGROUNDS, d.design.bg!)!;
      const ink = hex(TEXTS, d.design.ink!)!;
      expect(bg, d.key).toBeTruthy();
      expect(contrast(ink, bg), `${d.key} 글자색`).toBeGreaterThanOrEqual(4.5);
      if (d.design.accent !== 'mono') {
        const ac = hex(ACCENTS, d.design.accent!)!;
        expect(contrast(ac, bg), `${d.key} 강조색`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('방향마다 실제로 다른 값을 준다 (이름만 다른 같은 디자인 금지)', () => {
    const sig = DESIGN_DIRECTIONS.map((d) => JSON.stringify([d.design.bg, d.design.font, d.design.page, d.design.coverLayout, d.design.worksLayout]));
    expect(new Set(sig).size).toBe(DESIGN_DIRECTIONS.length);
  });

  it('추천은 3개이고 **같은 입력이면 같은 순서** (§31 결정적)', () => {
    const c = analyzePortfolio({ images: works(20, { title: '가', sizeText: '50×70 cm' }) });
    const a = recommendDirections(c).map((r) => r.direction.key);
    const b = recommendDirections(c).map((r) => r.direction.key);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it('추천이 포트폴리오 속성을 실제로 반영한다 — 작품이 많으면 모아보기, 적으면 안 나온다', () => {
    const many = recommendDirections(analyzePortfolio({ images: works(30) })).map((r) => r.direction.key);
    const few = recommendDirections(analyzePortfolio({ images: works(4) })).map((r) => r.direction.key);
    expect(many).toContain('collection');
    expect(few).not.toContain('collection');
  });

  it('가로 작품이 많으면 가로 지면 방향을 추천한다', () => {
    const c = analyzePortfolio({ images: works(12, { sizeText: '120×60 cm' }) });
    const keys = recommendDirections(c).map((r) => r.direction.key);
    expect(keys).toContain('artwork');
    expect(directionByKey('artwork')!.design.page).toBe('a4-landscape');
  });

  it('추천에는 이유가 붙는다 (§25 왜 이 방향인지 말한다)', () => {
    const recs = recommendDirections(analyzePortfolio({ images: works(30) }));
    for (const r of recs) expect(r.why.length).toBeGreaterThan(5);
  });
});

describe('페이지 전략 — 균형 분할', () => {
  it('⚠️ 고아 페이지를 만들지 않는다 (7점을 6점씩 → 6+1 이 아니라 4+3)', () => {
    expect(balancedSplit(7, 6)).toEqual([4, 3]);
    expect(balancedSplit(13, 6)).toEqual([5, 4, 4]);
    expect(balancedSplit(8, 6)).toEqual([4, 4]);
  });

  it('남는 게 넉넉하면 꽉 찬 페이지를 지킨다 (11점@6 → 6+5)', () => {
    expect(balancedSplit(11, 6)).toEqual([6, 5]);
    expect(balancedSplit(12, 6)).toEqual([6, 6]);
  });

  it('나눌 게 없으면 그대로', () => {
    expect(balancedSplit(0, 4)).toEqual([]);
    expect(balancedSplit(3, 4)).toEqual([3]);
    expect(balancedSplit(5, 1)).toEqual([1, 1, 1, 1, 1]);
  });

  it('합계는 언제나 보존된다 (작품이 사라지지 않는다)', () => {
    for (let n = 1; n <= 40; n++) {
      for (const per of [1, 2, 3, 4, 6]) {
        const s = balancedSplit(n, per);
        expect(s.reduce((a, b) => a + b, 0), `${n}@${per}`).toBe(n);
        expect(Math.max(...s), `${n}@${per}`).toBeLessThanOrEqual(per);
      }
    }
  });
});

describe('페이지 전략 — 자동 편집', () => {
  const auto = normalizePdfDesign({ auto: true });
  const manual = (worksLayout: string) => normalizePdfDesign({ worksLayout, auto: false });

  it('수동이면 고른 배치 하나로만 만든다 (§32 사용자 의도 존중)', () => {
    const plans = planWorkPages(works(9), manual('grid'));
    expect(new Set(plans.map((p) => p.composition))).toEqual(new Set(['grid']));
  });

  it('수동이어도 **분할은 균형 있게** 한다 (남은 1점이 혼자 한 장을 먹지 않게)', () => {
    const plans = planWorkPages(works(7), manual('index'));
    expect(plans.map((p) => p.items.length)).toEqual([4, 3]);
  });

  it('자동이면 같은 구성이 계속 반복되지 않는다', () => {
    const plans = planWorkPages(works(30), auto, 30);
    const kinds = plans.map((p) => p.composition);
    // 같은 구성이 3장 넘게 연달아 오지 않는다
    let run = 1, max = 1;
    for (let i = 1; i < kinds.length; i++) { run = kinds[i] === kinds[i - 1] ? run + 1 : 1; max = Math.max(max, run); }
    expect(max).toBeLessThanOrEqual(3);
    expect(new Set(kinds).size).toBeGreaterThan(1);
  });

  it('작품이 적으면 자동도 한 점씩 크게 (넉넉하게)', () => {
    const plans = planWorkPages(works(5), auto, 5);
    expect(plans.every((p) => p.composition === 'hero')).toBe(true);
  });

  it('⚠️ 밀도는 **전체 작품 수**로 정한다 — 시리즈만 보면 27점이 전부 같은 구성이 된다', () => {
    const asSeries = planWorkPages(works(6), auto, 6).map((p) => p.composition);
    const asPartOfBig = planWorkPages(works(6), auto, 30).map((p) => p.composition);
    expect(asSeries.every((c) => c === 'hero')).toBe(true);
    expect(asPartOfBig.every((c) => c === 'hero')).toBe(false);
  });

  it('작품 수가 보존된다 (어떤 조합에서도 한 점도 잃지 않는다)', () => {
    for (const n of [1, 2, 3, 5, 7, 9, 13, 27, 30]) {
      for (const d of [auto, manual('hero'), manual('duo'), manual('grid'), manual('index'), manual('feature')]) {
        const plans = planWorkPages(works(n), d, n);
        expect(plans.reduce((s, p) => s + p.items.length, 0), `${n} / ${d.worksLayout}/${d.auto}`).toBe(n);
        for (const p of plans) expect(p.items.length).toBeLessThanOrEqual(WORKS_PER_PAGE[p.composition]);
      }
    }
  });
});

describe('작품 비율이 배치에 반영된다', () => {
  const mk = (aspects: Record<string, number>, n: number): PortfolioBookData => ({
    user: { name: '작가' },
    images: Array.from({ length: n }, (_, i) => img({ id: i + 1, url: `u${i}`, series: 'S' })),
    aspects,
    seriesInfo: [],
  });
  const boxes = (html: string) => [...html.matchAll(/height:(\d+)px;width:100%/g)].map((m) => Number(m[1]));

  it('세로 그림과 가로 그림은 **다른 폭**을 받는다 (같은 칸에 우겨넣지 않는다)', () => {
    const d = mk({ u0: 0.7, u1: 1.6 }, 2);
    const html = buildPortfolioPages(d, themeById('archive'), { design: { worksLayout: 'duo', auto: false } })
      .find((p) => p.label === 'S')!.html;
    // 칸(track) 래퍼가 아니라 **작품 상자**만 — `min-width:0` 이 붙은 쪽이 작품 상자다
    const widths = [...html.matchAll(/flex:0 0 (\d+)px;max-width:\d+px;min-width:0/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(2);
    expect(widths[1]).toBeGreaterThan(widths[0]! * 1.5); // 가로 그림이 훨씬 넓다
  });

  it('한 행의 작품은 **같은 높이**다 (아래 선이 맞는다)', () => {
    const d = mk({ u0: 0.7, u1: 1.6, u2: 1.0, u3: 0.9 }, 4);
    const html = buildPortfolioPages(d, themeById('archive'), { design: { worksLayout: 'grid', auto: false } })
      .find((p) => p.label === 'S')!.html;
    const hs = boxes(html);
    expect(hs.length).toBe(4);
    expect(new Set(hs).size).toBeLessThanOrEqual(2); // 2행이므로 행마다 하나씩
  });

  it('⚠️ 캡션 예약은 **전체 작품**에서 뽑는다 — 그 장의 작품만 보면 장마다 칸이 달라진다', () => {
    // 어느 한 작품의 제목이 길어지면 **모든** 격자 장의 칸이 같이 낮아져야 한다(격자는 격자다).
    // 세로로 긴 작품(0.5)이라 칸 높이가 **높이 예산**에서 정해진다 — 캡션 예약의 영향이 보이는 조건.
    // (정사각 작품은 폭에서 먼저 걸려 캡션이 얼마든 칸 높이가 안 변한다)
    const maxCellPerPage = (imgs: PortfolioImage[]) =>
      buildPortfolioPages(
        { user: { name: '작가' }, images: imgs, seriesInfo: [],
          aspects: Object.fromEntries(imgs.map((w) => [w.url, 0.5])) },
        themeById('archive'), { design: { worksLayout: 'grid', auto: false, worksCaption: 'below' } },
      ).filter((pg) => pg.label === 'S').map((pg) => Math.max(...boxes(pg.html)));
    const plain = Array.from({ length: 8 }, (_, i) => img({ id: i + 1, url: `u${i}`, series: 'S', title: '짧은 제목', medium: '캔버스에 유채' }));
    const withLong = plain.map((w, i) => (i === 0 ? { ...w, title: '이름 없는 정원에서 보낸 아주 긴 여름날의 오후' } : w));
    const a = maxCellPerPage(plain), b = maxCellPerPage(withLong);
    expect(a.length).toBeGreaterThan(1);
    expect(new Set(a).size, '같은 조건이면 장마다 칸 높이가 같다').toBe(1);
    expect(new Set(b).size, '긴 제목이 생겨도 장마다 칸 높이는 서로 같다').toBe(1);
    expect(b[0]!, '긴 제목 때문에 모든 장의 칸이 함께 낮아진다').toBeLessThan(a[0]!);
  });

  it('비율을 몰라도 페이지가 나온다 (측정 전에도 문서는 만들어진다)', () => {
    const d = mk({}, 4);
    const pages = buildPortfolioPages(d, themeById('archive'), { design: { worksLayout: 'grid', auto: false } });
    expect(pages.some((p) => p.label === 'S')).toBe(true);
  });
});

describe('페이지 성격 표시 (kind/works) — 전체 구성 보기·안내의 근거', () => {
  const d: PortfolioBookData = {
    user: { name: '작가' }, statement: '노트', biography: '약력',
    career: { artFair: [], solo: [{ year: '2025', content: '개인전' }], group: [] },
    seriesInfo: [{ name: 'S', note: '시리즈 소개' }],
    images: works(9, { title: '작품' }),
  };

  it('표지·글·작품·CV·연락처가 모두 표시된다', () => {
    const pages = buildPortfolioPages(d, themeById('archive'));
    expect(pages[0]!.kind).toBe('cover');
    expect(pages[pages.length - 1]!.kind).toBe('contact');
    expect(pages.some((p) => p.kind === 'works')).toBe(true);
    expect(pages.some((p) => p.kind === 'cv')).toBe(true);
    expect(pages.filter((p) => p.kind === 'works').every((p) => (p.works ?? 0) > 0)).toBe(true);
  });

  it('실린 작품 수의 합이 실제 작품 수와 같다 (빠뜨리거나 겹치지 않는다)', () => {
    for (const design of [{ auto: true }, { worksLayout: 'grid', auto: false }, { worksLayout: 'index', auto: false }]) {
      const pages = buildPortfolioPages(d, themeById('archive'), { design });
      expect(pages.reduce((s, p) => s + (p.works ?? 0), 0), JSON.stringify(design)).toBe(9);
    }
  });
});
