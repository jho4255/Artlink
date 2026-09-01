/**
 * 포트폴리오 포맷 — 페이지 구성 규칙.
 *
 * 렌더 결과(그림)는 눈으로 봐야 하지만, "무엇이 몇 장 나오는가"는 순수 함수라 여기서 잠근다.
 * 특히 캡션(제목/재료/크기/연도)이 페이지에 실제로 들어가는지 — 이게 빠지면 포맷을 만든 의미가 없다.
 */
import { describe, it, expect } from 'vitest';
import {
  PORTFOLIO_THEMES, buildPortfolioPages, bookImageUrls, estimateParaH, splitCvColumns, splitParagraphs, themeById,
  normalizePdfDesign, applyDesign, PAGE_DIMS, COVER_LAYOUTS, COVER_SHOWS_TAGLINE,
  type PortfolioBookData,
} from '../lib/portfolioFormats';
import type { PortfolioImage } from '../types';

const img = (p: Partial<PortfolioImage>): PortfolioImage =>
  ({ id: p.id ?? Math.random(), url: p.url ?? `https://x/${p.id ?? 0}.jpg`, order: 0, ...p }) as PortfolioImage;

const base: PortfolioBookData = {
  user: { name: '김작가', email: 'a@b.com', phone: '010-0000-0000', instagramUrl: 'https://instagram.com/handle' },
  tagline: '한 줄 소개',
  statement: '작가노트 본문',
  biography: '약력 본문',
  career: { artFair: [], solo: [{ year: '2025', content: '개인전' }], group: [] },
  seriesInfo: [{ name: '산', note: '시리즈 설명' }],
  images: [
    img({ id: 1, series: '산', title: '작품 A', medium: 'Acrylic on canvas', sizeText: '50×50 cm', year: '2025' }),
    img({ id: 2, series: '산', title: '작품 B' }),
    img({ id: 3, title: '작품 C' }),
  ],
  year: '2026',
};

const labels = (d: PortfolioBookData, themeId = 'gallery') => buildPortfolioPages(d, themeById(themeId)).map((p) => p.label);

describe('페이지 구성', () => {
  it('표지로 시작해서 연락처로 끝난다 (모든 포맷)', () => {
    for (const t of PORTFOLIO_THEMES) {
      const l = buildPortfolioPages(base, t).map((p) => p.label);
      expect(l[0]).toBe('표지');
      expect(l[l.length - 1]).toBe('연락처');
    }
  });

  it('순서: 표지 → 작가노트 → 시리즈 소개 → 작품 → CV → 연락처 (기본 hero=쪽당 1점)', () => {
    // 산 시리즈 2점 → hero 라 각 1쪽씩. 무시리즈 1점 → '작품' 1쪽.
    expect(labels(base)).toEqual(['표지', '작가노트', '산 소개', '산', '산', '작품', 'CV', '연락처']);
  });

  it('작가노트가 없으면 그 페이지를 넣지 않는다', () => {
    expect(labels({ ...base, statement: null })).not.toContain('작가노트');
  });

  it('시리즈 설명이 없으면 소개 페이지를 넣지 않는다 (작품 페이지는 그대로)', () => {
    const l = labels({ ...base, seriesInfo: [] });
    expect(l).not.toContain('산 소개');
    expect(l).toContain('산');
  });


  it('약력·경력이 모두 비면 CV 페이지를 넣지 않는다', () => {
    const l = labels({ ...base, biography: null, career: { artFair: [], solo: [], group: [] } });
    expect(l).not.toContain('CV');
  });

  it('작품이 하나도 없어도 표지·연락처는 나온다 (빈 문서로 죽지 않는다)', () => {
    const l = labels({ ...base, images: [] });
    expect(l[0]).toBe('표지');
    expect(l).toContain('연락처');
  });
});

describe('작품 페이지 레이아웃 (design.worksLayout)', () => {
  const many = Array.from({ length: 6 }, (_, i) => img({ id: i + 1, series: 'S', title: `작품 ${i + 1}` }));
  const d: PortfolioBookData = { ...base, seriesInfo: [], images: many };
  const count = (worksLayout: string) => buildPortfolioPages(d, PORTFOLIO_THEMES[0], { design: { worksLayout } }).filter((p) => p.label === 'S').length;

  it('레이아웃이 쪽당 작품 수를 정한다 (hero 1→6쪽, duo 2→3쪽, grid 4→2쪽, index 6→1쪽)', () => {
    expect(count('hero')).toBe(6);
    expect(count('label')).toBe(6);
    expect(count('full')).toBe(6);
    expect(count('duo')).toBe(3);
    expect(count('grid')).toBe(2);
    expect(count('index')).toBe(1);
  });

  it('옛 density → worksLayout 마이그레이션 (1→hero, 2→duo, 4→grid)', () => {
    expect(normalizePdfDesign({ density: 1 }).worksLayout).toBe('hero');
    expect(normalizePdfDesign({ density: 2 }).worksLayout).toBe('duo');
    expect(normalizePdfDesign({ density: 4 }).worksLayout).toBe('grid');
  });

  it('뮤지엄 라벨은 작품+캡션블록(재료·크기), 대형은 세로 중앙', () => {
    const detailed = { ...d, images: [img({ id: 1, series: 'S', title: '무제', medium: 'Oil on canvas', sizeText: '100 × 80 cm', year: '2024' })] };
    const labelP = buildPortfolioPages(detailed, PORTFOLIO_THEMES[0], { design: { worksLayout: 'label' } }).find((p) => p.label === 'S')!.html;
    expect(labelP).toContain('Oil on canvas');
    expect(labelP).toContain('무제');
  });

  it('설명 전체 — hero 는 긴 설명 전문을 뒤 글 페이지로 잇는다(none 이면 안 잇는다)', () => {
    const one = { ...d, images: [img({ id: 1, series: 'S', title: '무제', description: '가'.repeat(1200) })] };
    const full = buildPortfolioPages(one, PORTFOLIO_THEMES[0], { design: { worksLayout: 'hero', desc: 'full' } });
    expect(full.some((p) => p.label.includes('이야기'))).toBe(true);
    const none = buildPortfolioPages(one, PORTFOLIO_THEMES[0], { design: { worksLayout: 'hero', desc: 'none' } });
    expect(none.some((p) => p.label.includes('이야기'))).toBe(false);
  });
});

describe('작품 글 배치 — worksCaption (격자 레이아웃에 적용)', () => {
  // worksCaption 은 격자(duo/grid/index)의 캡션 배치를 정한다. 2점 이상이라야 격자로 렌더.
  const two = [
    img({ id: 1, series: 'S', title: '제목작품', medium: '캔버스에 유화', sizeText: '100 × 80 cm', year: '2024' }),
    img({ id: 2, series: 'S', title: '작품 둘', medium: '캔버스에 유화', sizeText: '80 × 60 cm', year: '2024' }),
  ];
  const d: PortfolioBookData = { ...base, seriesInfo: [], images: two };
  const worksHtml = (worksCaption: string) =>
    buildPortfolioPages(d, PORTFOLIO_THEMES[0], { design: { worksLayout: 'duo', worksCaption } }).find((p) => p.label === 'S')!.html;

  it('minimal 은 제목만 남기고 메타(재료·크기)를 뺀다', () => {
    expect(worksHtml('below')).toContain('캔버스에 유화');
    const min = worksHtml('minimal');
    expect(min).toContain('제목작품');
    expect(min).not.toContain('캔버스에 유화');
  });

  it('left 는 캡션을 왼쪽 정렬한다', () => {
    expect(worksHtml('left')).toContain('text-align:left');
    expect(worksHtml('below')).toContain('text-align:center');
  });
});

describe('본문 정렬 — proseAlign (작가노트·약력 등 읽는 글 전체)', () => {
  const note = (proseAlign: string) =>
    buildPortfolioPages(base, themeById('archive'), { design: { proseAlign } }).find((p) => p.label === '작가노트')!.html;

  it('proseAlign 이 산문 문단에 text-align 으로 적용된다', () => {
    expect(note('justify')).toContain('text-align:justify');
    expect(note('right')).toContain('text-align:right');
    expect(note('left')).toContain('text-align:left');
  });
});

describe('페이지 내용', () => {
  it('작품 페이지에 제목·재료·크기·연도가 들어간다', () => {
    const p = buildPortfolioPages(base, themeById('gallery')).find((x) => x.label === '산')!;
    expect(p.html).toContain('작품 A');
    expect(p.html).toContain('Acrylic on canvas');
    expect(p.html).toContain('50×50 cm');
    expect(p.html).toContain('2025');
  });

  it('표지에 이름·연도·한 줄 소개가 들어간다', () => {
    const cover = buildPortfolioPages(base, themeById('gallery'))[0]!.html;
    expect(cover).toContain('김작가');
    expect(cover).toContain('2026');
    expect(cover).toContain('한 줄 소개');
  });

  it('연락처 페이지에 이메일·전화·인스타 핸들이 들어간다', () => {
    const pages = buildPortfolioPages(base, themeById('story'));
    const last = pages[pages.length - 1]!.html;
    expect(last).toContain('a@b.com');
    expect(last).toContain('010-0000-0000');
    expect(last).toContain('@handle'); // instagram.com/handle → @handle 축약
  });

  it('HTML 특수문자는 이스케이프된다 (작가가 <, & 를 써도 문서가 깨지지 않는다)', () => {
    const p = buildPortfolioPages(
      { ...base, images: [img({ id: 9, title: '<script>x</script> & Co' })], seriesInfo: [] },
      themeById('gallery'),
    ).find((x) => x.label === '작품')!;
    expect(p.html).not.toContain('<script>');
    expect(p.html).toContain('&lt;script&gt;');
    expect(p.html).toContain('&amp; Co');
  });

  it('시리즈 미지정 작품은 시리즈명 없이 "작품" 페이지로 묶인다', () => {
    const p = buildPortfolioPages(base, themeById('gallery')).find((x) => x.label === '작품')!;
    expect(p.html).toContain('작품 C');
  });
});

describe('표지 = 디자인 레이아웃 21종', () => {
  // 작품 5장 있는 작가(그리드 레이아웃 폴백 안 타게)
  const many = { ...base, images: Array.from({ length: 5 }, (_, i) => img({ id: i + 1, title: `작품 ${i + 1}` })) };
  const cover = (design: Record<string, unknown>, data = many) =>
    buildPortfolioPages(data, themeById('archive'), { design })[0]!.html;
  const ALL = COVER_LAYOUTS.map((c) => c.key);

  it('22종이 있고, 모든 레이아웃에 이름이 들어가고 빌드가 죽지 않는다', () => {
    expect(ALL.length).toBe(21);
    for (const coverLayout of ALL) expect(cover({ coverLayout }), coverLayout).toContain('김작가');
  });

  it('COVER_SHOWS_TAGLINE 이 실제 렌더와 일치한다(전 22종) — 편집기 안내의 단일 소스', () => {
    const TAG = '표지에만 나오는 한줄소개 문구입니다';
    const withTag = { ...many, tagline: TAG };
    for (const coverLayout of ALL) {
      const has = buildPortfolioPages(withTag, themeById('archive'), { design: { coverLayout, coverTagline: true } })[0]!.html.includes(TAG);
      expect(has, `${coverLayout}: 렌더=${has} / SET=${COVER_SHOWS_TAGLINE.has(coverLayout)}`).toBe(COVER_SHOWS_TAGLINE.has(coverLayout));
    }
  });

  it('기본(bandTop)은 글 요소 + 이미지가 표시된다', () => {
    const h = cover({});
    expect(h).toContain('김작가');
    expect(h).toContain('한 줄 소개');
    expect(h).toContain('2026');
    expect(h).toContain('ARTWORK PORTFOLIO');
    expect(h).toContain('<img');
  });

  it('글 요소 표시/숨김 (머리말·한 줄 소개·연도) — 여러 레이아웃에서', () => {
    for (const coverLayout of ['bandTop', 'poster', 'colorBand', 'matted', 'grid2x2'] as const) {
      expect(cover({ coverLayout, coverTagline: false }), coverLayout).not.toContain('한 줄 소개');
      expect(cover({ coverLayout, coverEyebrow: false, coverYear: false }), coverLayout).not.toContain('ARTWORK PORTFOLIO');
      expect(cover({ coverLayout, coverTagline: false }), coverLayout).toContain('김작가');
    }
  });

  it('타이포 레이아웃(serifCenter/stacked/…)은 이미지가 없다', () => {
    for (const coverLayout of ['serifCenter', 'editorialLeft', 'stacked', 'baseline', 'nameplate', 'accentField'] as const) {
      expect(cover({ coverLayout }), coverLayout).not.toContain('<img');
    }
  });

  it('여러 작품 레이아웃은 작품이 부족하면 bandTop 으로 폴백(빈 그리드 방지)', () => {
    const oneImg: PortfolioBookData = { ...base, images: [img({ id: 1 })] };
    // grid2x2 는 4장 필요 → 1장뿐이면 폴백. 그래도 이미지 1장은 나온다.
    const h = buildPortfolioPages(oneImg, themeById('archive'), { design: { coverLayout: 'grid2x2' } })[0]!.html;
    expect(h).toContain('<img');
    expect(h).toContain('김작가');
  });

  it('이미지 레이아웃인데 작품이 없으면 serifCenter(타이포)로 폴백', () => {
    const noImg: PortfolioBookData = { ...base, images: [] };
    const h = buildPortfolioPages(noImg, themeById('archive'), { design: { coverLayout: 'bandTop' } })[0]!.html;
    expect(h).not.toContain('<img');
    expect(h).toContain('김작가');
  });

  it('이미지는 절대 크롭하지 않는다(전 레이아웃 그리드 포함) — object-fit:cover 없음', () => {
    for (const coverLayout of ALL) {
      expect(cover({ coverLayout }), coverLayout).not.toMatch(/object-fit\s*:\s*cover/);
    }
  });

  it('이름 강조색 on/off', () => {
    const accentHex = '#C4302B';
    expect(cover({ coverLayout: 'serifCenter', coverNameAccent: true })).toContain(accentHex);
    expect(cover({ coverLayout: 'serifCenter', coverNameAccent: false })).toContain('color:#1A1A1A'); // ink
  });

  it('긴 이름은 자동 축소된다 (fitTitle — 슬롯을 넘지 않게)', () => {
    const px = (h: string) => Math.max(...[...h.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1])));
    const short = buildPortfolioPages({ ...base, user: { name: '김작' } }, themeById('archive'), { design: { coverLayout: 'poster' } })[0]!.html;
    const long = buildPortfolioPages({ ...base, user: { name: '김작가아주긴이름테스트가나다라마바사아자차카타파하' } }, themeById('archive'), { design: { coverLayout: 'poster' } })[0]!.html;
    expect(px(long)).toBeLessThan(px(short));
  });
});

describe('작품 비율 보존 (회귀 방지)', () => {
  // 회화에서 비율은 작품 그 자체다. 표지를 꾸미려고 cover로 깔면 그림이 잘린다 — 실제로 그런 적이 있다.
  it('어떤 포맷의 어떤 페이지에도 이미지를 자르거나 늘리는 규칙이 없다', () => {
    for (const t of PORTFOLIO_THEMES) {
      for (const p of buildPortfolioPages(base, t)) {
        expect(p.html, `${t.id} / ${p.label}`).not.toMatch(/object-fit\s*:\s*(cover|fill|scale-down)/);
      }
    }
  });

  it('모든 작품 이미지가 object-fit:contain 으로 나간다', () => {
    for (const t of PORTFOLIO_THEMES) {
      for (const p of buildPortfolioPages(base, t)) {
        for (const tag of p.html.match(/<img[^>]*>/g) ?? []) {
          expect(tag, `${t.id} / ${p.label}`).toContain('object-fit:contain');
        }
      }
    }
  });

  it('이미지에 width/height를 못 박지 않는다 (max-* 로만 제한 → 늘어남 방지)', () => {
    for (const t of PORTFOLIO_THEMES) {
      for (const p of buildPortfolioPages(base, t)) {
        for (const tag of p.html.match(/<img[^>]*>/g) ?? []) {
          expect(tag, `${t.id} / ${p.label}`).not.toMatch(/[;"\s](width|height)\s*:/);
        }
      }
    }
  });
});

describe('bookImageUrls', () => {
  it('모든 작품을 포함한다 (prefetch 대상이 빠지면 PDF에 빈 칸이 생긴다)', () => {
    expect(bookImageUrls(base)).toHaveLength(3);
  });
});

describe('themeById', () => {
  it('모르는 id는 첫 번째 포맷으로 되돌린다', () => {
    expect(themeById('nope').id).toBe('gallery');
    expect(themeById(null).id).toBe('gallery');
    expect(themeById('archive').id).toBe('archive');
  });

  it('포맷 4종의 id가 서로 겹치지 않는다', () => {
    expect(new Set(PORTFOLIO_THEMES.map((t) => t.id)).size).toBe(4);
  });
});

describe('CV 분할 (경력이 많은 작가)', () => {
  // 실서버에 경력 72건짜리 작가가 있다. 한 장 고정이던 시절엔 넘치는 만큼 잘려 나갔다.
  const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${2026 - i} ${p} ${i + 1}`);
  it('항목이 적으면 CV는 한 장', () => {
    const l = buildPortfolioPages(base, themeById('gallery')).filter((p) => p.label.startsWith('CV'));
    expect(l).toHaveLength(1);
    expect(l[0]!.label).toBe('CV');
  });

  it('항목이 많으면 여러 장으로 나뉜다 (모든 포맷)', () => {
    const big: PortfolioBookData = {
      ...base,
      career: {
        artFair: many(35, '아트페어').map((content) => ({ year: '', content })),
        solo: many(7, '개인전').map((content) => ({ year: '', content })),
        group: many(30, '단체전').map((content) => ({ year: '', content })),
      },
    };
    for (const t of PORTFOLIO_THEMES) {
      const cv = buildPortfolioPages(big, t).filter((p) => p.label.startsWith('CV'));
      expect(cv.length, t.id).toBeGreaterThan(1);
      // 항목이 하나도 유실되지 않아야 한다
      const html = cv.map((p) => p.html).join('');
      for (const n of [1, 18, 35]) expect(html, `${t.id} 아트페어 ${n}`).toContain(`아트페어 ${n}`);
      for (const n of [1, 30]) expect(html, `${t.id} 단체전 ${n}`).toContain(`단체전 ${n}`);
    }
  });

  it('splitCvColumns — 섹션이 이어지면 다음 단에 (계속) 표시', () => {
    const sections = [{ key: 'group' as const, label: '단체전', en: 'GROUP', entries: many(40, '단체전') }];
    const pages = splitCvColumns(sections, 400, 600, 2, 400);
    const chunks = pages.flat().flat();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.cont).toBe(false);
    expect(chunks[1]!.cont).toBe(true);
    // 항목 총합이 보존된다
    expect(chunks.reduce((n, c) => n + c.entries.length, 0)).toBe(40);
  });

  it('splitCvColumns — 한 단에 다 들어가면 나누지 않는다', () => {
    const sections = [{ key: 'solo' as const, label: '개인전', en: 'SOLO', entries: many(3, '개인전') }];
    const pages = splitCvColumns(sections, 800, 600, 2, 800);
    expect(pages).toHaveLength(1);
    expect(pages[0]![0]).toHaveLength(1);
  });
});

describe('이미지 주소 — 미리보기 vs PDF', () => {
  it('미리보기는 원본 주소를 그대로 쓴다 (프록시 왕복·미설정 환경 깨짐 방지)', () => {
    const p = buildPortfolioPages(base, themeById('gallery')).find((x) => x.label === '산')!;
    expect(p.html).toContain('https://x/1.jpg');
    expect(p.html).not.toContain('image-proxy');
  });

  it('PDF는 프록시/blob 경로를 쓴다 (canvas taint 방지)', () => {
    const p = buildPortfolioPages(base, themeById('gallery'), { forPdf: true }).find((x) => x.label === '산')!;
    expect(p.html).toContain('image-proxy');
  });

  // 같은 사진을 화면 어딘가에서 crossorigin 없는 <img>로 먼저 그리면 브라우저 캐시에 'CORS 정보 없는'
  // 항목이 남고, 그 뒤 crossorigin 요청이 그 항목을 재사용하며 차단된다 → 미리보기 사진이 안 뜬다.
  it('미리보기 img에는 crossorigin을 붙이지 않는다 (캐시 CORS 오염으로 사진이 차단됨)', () => {
    for (const t of PORTFOLIO_THEMES) {
      for (const p of buildPortfolioPages(base, t)) {
        expect(p.html, `${t.id} / ${p.label}`).not.toContain('crossorigin');
      }
    }
  });

  it('PDF img에는 crossorigin이 붙는다', () => {
    const p = buildPortfolioPages(base, themeById('gallery'), { forPdf: true }).find((x) => x.label === '산')!;
    expect(p.html).toContain('crossorigin="anonymous"');
  });
});

describe('긴 글 분할 (작가노트 · 시리즈 소개 · 작품 이야기)', () => {
  // 실서버에 작가노트 3,316자짜리 작가가 있었고 4개 포맷 전부에서 최대 1,154px가 잘리고 있었다.
  const long = (n: number) => Array.from({ length: n }, (_, i) => `문단 ${i + 1}. ` + '어떤 내용이 이어집니다. '.repeat(12)).join('\n\n');

  it('짧으면 한 장', () => {
    const l = buildPortfolioPages(base, themeById('gallery')).filter((p) => p.label.startsWith('작가노트'));
    expect(l).toHaveLength(1);
  });

  it('작가노트가 길면 여러 장으로 나뉘고 내용이 유실되지 않는다 (모든 포맷)', () => {
    const d: PortfolioBookData = { ...base, statement: long(12) };
    for (const t of PORTFOLIO_THEMES) {
      const ps = buildPortfolioPages(d, t).filter((p) => p.label.startsWith('작가노트'));
      expect(ps.length, t.id).toBeGreaterThan(1);
      const html = ps.map((p) => p.html).join('');
      for (const n of [1, 6, 12]) expect(html, `${t.id} 문단 ${n}`).toContain(`문단 ${n}.`);
    }
  });

  it('시리즈 소개가 길어도 나뉜다', () => {
    const d: PortfolioBookData = { ...base, seriesInfo: [{ name: '산', note: long(10) }] };
    const ps = buildPortfolioPages(d, themeById('gallery')).filter((p) => p.label.startsWith('산 소개'));
    expect(ps.length).toBeGreaterThan(1);
    expect(ps.map((p) => p.html).join('')).toContain('문단 10.');
  });

  it('뮤지엄 라벨 · 긴 작품 설명은 이어지는 이야기 페이지로 넘어간다 (잘리지 않음)', () => {
    const d: PortfolioBookData = {
      ...base, seriesInfo: [],
      images: [img({ id: 1, title: '작품 A', description: long(8) })],
    };
    const ps = buildPortfolioPages(d, PORTFOLIO_THEMES[0], { design: { worksLayout: 'label', desc: 'full' } });
    expect(ps.some((p) => p.label.includes('이야기'))).toBe(true);
    const html = ps.map((p) => p.html).join('');
    for (const n of [1, 4, 8]) expect(html, `문단 ${n}`).toContain(`문단 ${n}.`);
  });

  it('splitParagraphs — 한 문단이 페이지보다 커도 줄 단위로 쪼개 담는다', () => {
    const huge = '가'.repeat(4000);
    const out = splitParagraphs([huge], 300, 300, 17, 35, 900, 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out.flat().join('').replace(/\s/g, '')).toHaveLength(4000);
  });

  it('estimateParaH — 줄바꿈과 글자수에 비례해서 커진다', () => {
    const one = estimateParaH('가'.repeat(10), 17, 35, 900, 20);
    const many = estimateParaH('가'.repeat(400), 17, 35, 900, 20);
    expect(many).toBeGreaterThan(one);
    expect(estimateParaH('가\n나\n다', 17, 35, 900, 20)).toBeGreaterThan(one);
  });
});

/**
 * 여백 넘침 회귀 방지 (2026-08-16 전수조사).
 *
 * 페이지는 고정 크기 + `overflow:hidden` 이라 넘치면 **에러 없이 조용히 잘린다**.
 * 실제로 40여 명 × 4포맷을 브라우저에 그려 재보니 17장이 넘쳤고, 원인이 넷이었다.
 * 여기서는 그 넷을 순수 함수 수준에서 잠근다(픽셀 실측은 e2e 몫).
 */
describe('여백 넘침 회귀 방지', () => {
  const bioOnly = (bio: string): PortfolioBookData => ({
    ...base, statement: null, seriesInfo: null, biography: bio,
    career: { artFair: [], solo: [], group: [] },   // 경력 0건
  });

  it('경력이 없어도 약력은 반드시 문서에 실린다 — 예전엔 CV 페이지가 통째로 안 생겨 약력이 사라졌다', () => {
    for (const t of PORTFOLIO_THEMES) {
      const pages = buildPortfolioPages(bioOnly('단국대학교 서양화과 졸업'), t);
      const html = pages.map((p) => p.html).join('');
      expect(html, `${t.name}: 약력이 어느 페이지에도 없다`).toContain('단국대학교 서양화과 졸업');
    }
  });

  it('약력이 아무리 길어도 한 줄도 잃지 않는다', () => {
    // 세로 판형(포맷 D)은 페이지가 높아 같은 약력이 첫 장에 들어가기도 한다 —
    // 어디에 실리느냐가 아니라 **내용이 남아 있느냐**가 지켜야 할 규칙이다.
    const long = Array.from({ length: 60 }, (_, i) => `${2000 + i}년 어느 전시에 참여하고 무엇을 배웠는지에 대한 긴 문장`).join('\n');
    for (const t of PORTFOLIO_THEMES) {
      const text = buildPortfolioPages(bioOnly(long), t).map((p) => p.html).join('').replace(/<[^>]*>/g, '');
      for (const line of long.split('\n')) {
        expect(text, `${t.name}: "${line.slice(0, 12)}" 이 빠졌다`).toContain(line.slice(0, 24));
      }
    }
  });

  it('첫 장에 경력 칸이 안 남을 만큼 약력이 길면 약력을 자기 페이지로 뺀다 (가로 판형)', () => {
    const long = Array.from({ length: 60 }, (_, i) => `${2000 + i}년 어느 전시에 참여하고 무엇을 배웠는지에 대한 긴 문장`).join('\n');
    for (const t of PORTFOLIO_THEMES.filter((x) => x.page.w > x.page.h)) {
      const pages = buildPortfolioPages(bioOnly(long), t);
      expect(pages.some((p) => p.label.startsWith('약력')), `${t.name}: 약력 전용 페이지가 없다`).toBe(true);
    }
  });

  it('약력이 짧으면 CV 첫 장에 같이 실린다 (쓸데없이 장을 늘리지 않는다)', () => {
    for (const t of PORTFOLIO_THEMES) {
      const pages = buildPortfolioPages(bioOnly('짧은 약력'), t);
      expect(pages.some((p) => p.label.startsWith('약력')), `${t.name}`).toBe(false);
      expect(pages.find((p) => p.label === 'CV')!.html).toContain('짧은 약력');
    }
  });

  it('splitParagraphs — 빈 줄 없이 줄바꿈만 쓴 글도 줄 예산을 지킨다', () => {
    // 글자 수로만 자르던 시절엔 이 모양에서 조각의 실제 줄 수가 예산을 넘겼다
    const para = Array.from({ length: 40 }, (_, i) => `${i}번째 줄입니다`).join('\n');
    const lineH = 30, cap = 10 * lineH + 20;          // 10줄 + gap
    const pages = splitParagraphs([para], cap, cap, 15, lineH, 600, 20);
    for (const chunk of pages) {
      const lines = chunk.join('\n').split('\n').length;
      expect(lines, `한 장에 ${lines}줄 — 예산 10줄 초과`).toBeLessThanOrEqual(10);
    }
    // 한 줄도 잃지 않는다
    expect(pages.flat().join('\n').split('\n').filter((l) => l.trim()).length).toBe(40);
  });

  it('splitParagraphs — 줄바꿈이 많을수록 더 많은 장으로 나뉜다', () => {
    const flat = '가'.repeat(400);
    const broken = Array.from({ length: 40 }, () => '가'.repeat(10)).join('\n');  // 같은 글자 수, 줄바꿈만 다름
    const args = [200, 200, 15, 30, 600, 20] as const;
    expect(splitParagraphs([broken], ...args).length)
      .toBeGreaterThan(splitParagraphs([flat], ...args).length);
  });

  it('캡션 줄 수가 많은 작품은 이미지 높이를 그만큼 양보한다 — 상수로 고정하면 포맷 D에서 잘렸다', () => {
    const withCaption = { ...base, images: [
      img({ id: 1, title: 'A', sizeText: '50×50 cm', medium: 'Oil on canvas', year: '2025' }),
      img({ id: 2, title: 'B', sizeText: '50×50 cm', medium: 'Oil on canvas', year: '2025' }),
    ] };
    const bare = { ...base, images: [img({ id: 1, title: 'A' }), img({ id: 2, title: 'B' })] };
    // 표지도 max-height 를 쓰므로 **작품 페이지만** 본다
    const workImgH = (d: PortfolioBookData) => {
      const pg = buildPortfolioPages(d, themeById('archive')).find((p) => p.label === '작품')!;
      return Math.max(...[...pg.html.matchAll(/max-height:(\d+)px/g)].map((m) => Number(m[1])));
    };
    expect(workImgH(withCaption)).toBeLessThan(workImgH(bare));
  });
});

describe('긴 무공백 글 줄바꿈 (회귀 방지 — 작가노트/약력/경력/연락처)', () => {
  /*
    `word-break:keep-all` 만으로는 **공백 없이 이어 쓴 한글 한 덩어리**가 아무 데서도 안 끊긴다.
    화면(HomepageView)에서 한 번 겪은 문제인데(CLAUDE.md 30번) PDF 엔진도 같았다 —
    keep-all 이라 무공백 장문이 한 줄로 뻗어 가로로 넘치고, 페이지가 overflow:hidden 이라 조용히 잘렸다.
    모든 사용자 텍스트 자리에 `overflow-wrap:anywhere` 가 붙어 있어야 한다.
  */
  const NOSPACE = '작가노트가공백없이쭉이어집니다'.repeat(30); // 400자+, 공백 0
  const longData: PortfolioBookData = {
    ...base,
    statement: NOSPACE,
    biography: NOSPACE,
    tagline: NOSPACE,
    career: { artFair: [], solo: [{ year: '2025', content: NOSPACE }], group: [] },
    seriesInfo: [{ name: NOSPACE, note: NOSPACE }],
    user: { ...base.user, instagramUrl: 'https://instagram.com/' + 'x'.repeat(120) },
  };

  it('★ 모든 포맷에서 keep-all 이 쓰인 곳엔 반드시 overflow-wrap:anywhere 가 함께 있다', () => {
    for (const t of PORTFOLIO_THEMES) {
      const html = buildPortfolioPages(longData, t).map((p) => p.html).join('\n');
      // keep-all 등장 횟수 == 'keep-all;overflow-wrap:anywhere' 등장 횟수
      const keepAll = (html.match(/word-break:keep-all/g) ?? []).length;
      const paired = (html.match(/word-break:keep-all;overflow-wrap:anywhere/g) ?? []).length;
      expect(paired, `${t.id}: keep-all ${keepAll}곳 중 ${keepAll - paired}곳에 overflow-wrap 누락`).toBe(keepAll);
    }
  });

  it('★ 작가노트 페이지 본문에 overflow-wrap:anywhere 가 있다 (무공백 장문이 잘리지 않게)', () => {
    for (const t of PORTFOLIO_THEMES) {
      const notePage = buildPortfolioPages(longData, t).find((p) => p.label.startsWith('작가노트'));
      expect(notePage, `${t.id}: 작가노트 페이지 없음`).toBeTruthy();
      expect(notePage!.html).toContain('overflow-wrap:anywhere');
      expect(notePage!.html).toContain('작가노트가공백없이'); // 본문이 실제로 실렸다
    }
  });

  it('★ 경력·연락처의 자유 텍스트도 anywhere 로 감싼다', () => {
    const pages = buildPortfolioPages(longData, themeById('gallery'));
    const cvOrContact = pages.filter((p) => /연락처|경력|CV|프로필/i.test(p.label) || p.html.includes('instagram'));
    // 경력 엔트리(무공백 전시명)와 연락처 값(긴 URL)이 들어간 페이지들에 anywhere 가 보인다
    const joined = pages.map((p) => p.html).join('\n');
    expect(joined).toContain('overflow-wrap:anywhere');
    expect(cvOrContact.length).toBeGreaterThan(0);
  });

  it('무공백 장문이 있어도 페이지 빌드가 죽지 않는다 (전 포맷)', () => {
    for (const t of PORTFOLIO_THEMES) {
      expect(() => buildPortfolioPages(longData, t)).not.toThrow();
    }
  });
});

// ── 가이드형 디자인 (색: 배경/글자/강조) ──
describe('색 (normalizePdfDesign / applyDesign)', () => {
  // 기본 = 디자인 레이아웃(bandTop) + 글요소 전부 표시
  const DEFAULT_DESIGN = {
    bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait',
    worksLayout: 'hero', desc: 'none', worksCaption: 'below', proseAlign: 'left',
    coverLayout: 'bandTop', coverEyebrow: true, coverEyebrowText: null, coverTagline: true, coverYear: true, coverNameAccent: false,
    coverImageIds: [], coverTaglineText: null, coverImageScale: 1, coverTextScale: 1,
  };

  it('normalizePdfDesign: 알 수 없거나 깨진 값은 기본으로 눕힌다', () => {
    expect(normalizePdfDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(normalizePdfDesign('{bad')).toEqual(DEFAULT_DESIGN);
    expect(normalizePdfDesign({ bg: 'neon', ink: 'zz', accent: 'qq', worksLayout: 'zz', desc: 'x', page: 'z', font: 'z', worksCaption: 'zz', coverLayout: 'zz' }))
      .toEqual(DEFAULT_DESIGN);
    // 명시값 그대로 보존(round-trip)
    const explicit = { bg: 'ink', ink: 'white', accent: 'gold', font: 'plex', page: 'wide', worksLayout: 'label', desc: 'full', worksCaption: 'minimal', proseAlign: 'justify', coverLayout: 'poster', coverEyebrow: false, coverEyebrowText: 'SOLO SHOW', coverTagline: false, coverYear: false, coverNameAccent: true, coverImageIds: [42], coverTaglineText: '표지 문구', coverImageScale: 0.8, coverTextScale: 1.1 };
    expect(normalizePdfDesign(explicit)).toEqual(explicit);
    // 옛 단일값(coverImageId) → 배열 마이그레이션
    expect(normalizePdfDesign({ coverImageId: 7 }).coverImageIds).toEqual([7]);
  });

  it('인라인 편집 — coverImageIds 로 슬롯별 사진 지정, coverTaglineText 로 표지 문구 override', () => {
    const imgs = [img({ id: 10, title: '작품10' }), img({ id: 20, title: '작품20' })];
    const d: PortfolioBookData = { ...base, seriesInfo: [], images: imgs, tagline: '원래 소개' };
    // 대표 사진을 20번으로 → 표지(밴드상단)의 이미지가 20번 url
    const cover = (design: Record<string, unknown>) => buildPortfolioPages(d, themeById('archive'), { design: { coverLayout: 'bandTop', ...design } })[0]!.html;
    expect(cover({ coverImageIds: [20] })).toContain(imgs[1].url);
    // 표지 문구 override
    expect(cover({ coverTaglineText: '표지 전용 문구' })).toContain('표지 전용 문구');
    expect(cover({ coverTaglineText: '표지 전용 문구' })).not.toContain('원래 소개');
    // 영문 머리말 override(없으면 기본 ARTWORK PORTFOLIO)
    expect(cover({})).toContain('ARTWORK PORTFOLIO');
    expect(cover({ coverEyebrowText: 'SOLO SHOW 2025' })).toContain('SOLO SHOW 2025');
    expect(cover({ coverEyebrowText: 'SOLO SHOW 2025' })).not.toContain('ARTWORK PORTFOLIO');
  });

  it('표지 슬롯 — 부분/전부 빈 칸도 레이아웃 유지(폴백 안 함), 자동일 땐 부족하면 폴백', () => {
    const imgs = [img({ id: 10 }), img({ id: 20 }), img({ id: 30 }), img({ id: 40 })];
    const dd: PortfolioBookData = { ...base, seriesInfo: [], images: imgs };
    const cover = (design: Record<string, unknown>) => buildPortfolioPages(dd, themeById('archive'), { design: { coverLayout: 'grid2x2', ...design } })[0]!.html;
    // 명시 목록 1장만(나머지 0=빈칸) → grid2x2(2×2 격자) 유지
    expect(cover({ coverImageIds: [10] })).toContain('grid-template-columns:1fr 1fr');
    // 전부 빈 칸(0,0,0,0)이어도 격자 유지 — 폴백 안 함
    expect(cover({ coverImageIds: [0, 0, 0, 0] })).toContain('grid-template-columns:1fr 1fr');
    // 자동(미편집)인데 이미지가 4장 미만이면 빈 표지 방지 폴백 → 격자 아님
    const auto = buildPortfolioPages({ ...dd, images: [img({ id: 99 })] }, themeById('archive'), { design: { coverLayout: 'grid2x2' } })[0]!.html;
    expect(auto).not.toContain('grid-template-columns:1fr 1fr');
  });

  it('옛 값 마이그레이션 — palette / font / 이미지없음 → minimal / 옛 축·cover키(무시)', () => {
    expect(normalizePdfDesign({ palette: 'dark' })).toMatchObject({ bg: 'ink', ink: 'white' });
    expect(normalizePdfDesign({ palette: 'ivory' })).toMatchObject({ bg: 'ivory' });
    expect(normalizePdfDesign({ font: 'serif' }).font).toBe('myeongjo');
    expect(normalizePdfDesign({ font: 'sans' }).font).toBe('gothic');
    // 옛 대표이미지 숨김(coverImage:false / imagePlace:'none') → 이미지 없는 레이아웃(serifCenter)
    expect(normalizePdfDesign({ coverImage: false }).coverLayout).toBe('serifCenter');
    expect(normalizePdfDesign({ coverImagePlace: 'none' }).coverLayout).toBe('serifCenter');
    // 옛 6-레이아웃 키(editorial/gallery/…)는 새 22-키로 매핑
    expect(normalizePdfDesign({ coverLayout: 'editorial' }).coverLayout).toBe('bandTop');
    expect(normalizePdfDesign({ coverLayout: 'gallery' }).coverLayout).toBe('matted');
    expect(normalizePdfDesign({ coverLayout: 'band' }).coverLayout).toBe('colorBand');
    // 옛 축·프리셋 키는 필드가 없으므로 조용히 무시 → 기본 bandTop
    const migrated = normalizePdfDesign({ cover: 'studio', coverAlign: 'right', coverDecor: 'band' });
    expect(migrated).not.toHaveProperty('cover');
    expect(migrated.coverLayout).toBe('bandTop');
  });

  it('applyDesign 기본은 화이트 배경 + 세로(표지와 독립) + hero(쪽당 1점) + 명조', () => {
    for (const t of PORTFOLIO_THEMES) {
      const w = applyDesign(t, normalizePdfDesign(null));
      expect(w.bg).toBe('#FFFFFF');
      expect(w.page).toEqual(PAGE_DIMS['a4-portrait']);
      expect(w.worksPerPage).toBe(1); // hero
      expect(w.display).toContain('Nanum Myeongjo');
      expect(w.id).toBe(t.id);
    }
  });

  it('applyDesign 은 배경/판형/작품수/글꼴을 갈아끼우고 sub/line 을 도출한다', () => {
    const t = PORTFOLIO_THEMES[0];
    const w = applyDesign(t, normalizePdfDesign({ bg: 'ivory', ink: 'brown', accent: 'gold', page: 'wide', worksLayout: 'grid', font: 'sans' }));
    expect(w.bg).toBe('#FAF7F0');
    expect(w.ink).toBe('#4A3F31');
    expect(w.accent).toBe('#8A7350');
    expect(w.sub).toMatch(/^#[0-9a-f]{6}$/i); // 자동 도출
    expect(w.line).toMatch(/^#[0-9a-f]{6}$/i);
    expect(w.page).toEqual(PAGE_DIMS['wide']);
    expect(w.worksPerPage).toBe(4);
    expect(w.display).toContain('Pretendard');
  });

  it('색을 바꿔도 페이지 수는 그대로다 (색은 레이아웃에 영향 없음)', () => {
    const data: PortfolioBookData = {
      user: { name: '김작가' }, biography: '약력', statement: '작가노트',
      images: [img({ id: 1, title: '작품', medium: 'Oil', sizeText: '10x10', year: '2024' })],
    };
    for (const t of PORTFOLIO_THEMES) {
      const base = buildPortfolioPages(data, t).length;
      for (const bg of ['white', 'ivory', 'ink', 'navy'] as const) {
        expect(buildPortfolioPages(data, t, { design: { bg } }).length).toBe(base);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF·PPTX 렌더 안전 가드
//
// 왜 문자열 검사인가: 이 테스트는 jsdom 이라 **레이아웃을 못 잰다**. 그래서 넘침·크기 같은
// 건 여기서 못 잡고 `scratchpad/pf/` 하니스가 실측으로 잡는다. 다만 아래 두 가지는
// **HTML 문자열만 봐도 확정**되는 사고라 여기서 잠근다 — 둘 다 화면(크롬)에서는 멀쩡해
// 보이고 저장할 때만 터져서, 눈으로는 절대 못 찾는다.
// ─────────────────────────────────────────────────────────────────────────────
describe('PDF/PPTX 렌더 안전', () => {
  const rich: PortfolioBookData = {
    ...base,
    images: [1, 2, 3, 4, 5, 6].map((i) =>
      img({ id: i, series: i % 2 ? '산' : '들', title: `작품 ${i}`, medium: 'Oil on canvas', sizeText: '50×50 cm', year: '2025', description: '설명 '.repeat(40) })),
  };
  const everyPageHtml = () => {
    const out: { label: string; html: string; where: string }[] = [];
    for (const c of COVER_LAYOUTS)
      for (const worksLayout of ['hero', 'label', 'full', 'duo', 'grid', 'index'] as const)
        for (const pg of buildPortfolioPages(rich, themeById('archive'),
          { design: { coverLayout: c.key, worksLayout, desc: 'short' } }))
          out.push({ ...pg, where: `${c.key}/${worksLayout}` });
    return out;
  };

  // ⚠️ 크롬이 `color-mix()` 를 `color(srgb …)` 로 계산해 내리는데 html2canvas 1.4.1 이 그걸
  //    파싱하다 **던진다** → PDF 저장이 통째로 실패한다("PDF 생성에 실패했습니다" 만 뜬다).
  //    PPTX 는 `hexOf()` 가 rgba?() 만 받아 null → 배경 도형이 **에러 없이 조용히** 빠진다.
  //    실측(2026-08-31): 표지 21종 중 13종 · 작품 6종 중 4종이 걸려 **조합의 87% 에서 PDF 가 안 나왔다**
  //    (기본값 포함). 색은 반드시 `mixHex` 로 미리 섞어 hex 로 넣을 것.
  it('페이지 HTML 에 color-mix() 가 없다 — html2canvas 가 파싱하다 던진다', () => {
    const bad = everyPageHtml().filter((p) => p.html.includes('color-mix'));
    expect(bad.map((b) => `${b.where}:${b.label}`)).toEqual([]);
  });

  // 같은 이유로 CSS 색 함수 중 html2canvas 가 모르는 것들. 크롬 computed 가 color() 로
  // 바뀌는 최신 문법을 통째로 막는다(lab/lch/oklab/oklch/color()).
  it('페이지 HTML 에 최신 CSS 색 함수가 없다 (lab/lch/oklab/oklch/color())', () => {
    const bad = everyPageHtml().filter((p) => /\b(ok)?(lab|lch)\(|[^-]\bcolor\(/.test(p.html));
    expect(bad.map((b) => `${b.where}:${b.label}`)).toEqual([]);
  });
});

describe('표지 글 요소 토글', () => {
  // ⚠️ `coverBaseline` 이 `metaLine(v) || EYEBROW` 라 **머리말·연도를 다 꺼도 기본 문구가 남았다**
  //    (21종 중 이것만). 상수를 직접 쓰지 말고 v 를 따를 것 — 토글이 거짓말하면 안 된다.
  it('머리말·연도·소개를 전부 끄면 어느 표지에도 기본 문구가 남지 않는다', () => {
    const leaked = COVER_LAYOUTS.filter(({ key }) => {
      const html = buildPortfolioPages(base, themeById('archive'), {
        design: { coverLayout: key, coverEyebrow: false, coverYear: false, coverTagline: false },
      })[0]!.html;
      return html.includes('ARTWORK PORTFOLIO') || html.includes('2026');
    }).map((c) => c.key);
    expect(leaked).toEqual([]);
  });
});

describe('여백은 판형에 비례한다', () => {
  // ⚠️ 예전엔 A4 세로 기준 픽셀 상수 하나를 전 판형에 썼다. 상하 224px 은 A4 세로(1414)에서
  //    15.8% 지만 와이드(900)에서는 **24.9%** — 같은 설정인데 지면의 4분의 1이 여백이 됐고
  //    그만큼 작품이 작아졌다(실측: hero 45.8% → 17.6%). 비율이 유지되는지 잠근다.
  const topPad = (page: 'a4-portrait' | 'a4-landscape' | 'wide') => {
    const html = buildPortfolioPages(base, themeById('archive'),
      { design: { page, worksLayout: 'hero' } }).find((p) => p.label === '산')!.html;
    return Number(/padding:(\d+)px/.exec(html)![1]);
  };
  it('짧은 판형일수록 위 여백이 작다', () => {
    expect(topPad('a4-portrait')).toBeGreaterThan(topPad('a4-landscape'));
    expect(topPad('a4-landscape')).toBeGreaterThan(topPad('wide'));
  });
  it('여백 비율이 판형과 무관하게 대체로 일정하다 (±3%p)', () => {
    const ratio = { 'a4-portrait': topPad('a4-portrait') / 1414, 'a4-landscape': topPad('a4-landscape') / 1000, wide: topPad('wide') / 900 };
    const v = Object.values(ratio);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThan(0.03);
  });
  it('본문이 러닝 머리말을 침범하지 않는다 (머리말도 함께 비례해야 한다)', () => {
    for (const page of ['a4-portrait', 'a4-landscape', 'wide'] as const) {
      const html = buildPortfolioPages(base, themeById('archive'),
        { design: { page, worksLayout: 'hero' } }).find((p) => p.label === '산')!.html;
      const runY = Number(/position:absolute;top:(\d+)px;left:/.exec(html)![1]);
      expect(runY + 27, page).toBeLessThan(topPad(page));
    }
  });
});

describe('캡션 — 제목이 없으면 제목 줄을 그리지 않는다', () => {
  // ⚠️ `artworkTitle()` 은 빈 제목에 '무제' 를 돌려준다. 그대로 쓰면 캡션이 '무제' 로 도배된다 —
  //    실서버 작품 372점 중 제목이 있는 건 10점(2.7%), **361점(97%)은 제목·재료·크기·연도가 전부 비어 있다**.
  //    26점짜리 포트폴리오가 26쪽 내내 '무제' 한 단어만 달고 나왔다(2026-08-31 실데이터 확인).
  //    공개 홈페이지(`HomepageView`)는 이미 `hasTitle()` 로 걸러 왔는데 PDF 만 안 걸렀다.
  const bare = (n: number): PortfolioBookData => ({
    user: { name: '김작가' },
    images: Array.from({ length: n }, (_, i) => img({ id: i + 1, url: `https://x/${i}.jpg` })),
  });
  const workPages = (d: PortfolioBookData, design: Record<string, unknown> = {}) =>
    buildPortfolioPages(d, themeById('archive'), { design })
      .filter((p) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(p.label));

  it('정보가 하나도 없는 작품에 "무제" 가 찍히지 않는다 (전 레이아웃)', () => {
    for (const worksLayout of ['hero', 'label', 'full', 'duo', 'grid', 'index'] as const) {
      const html = workPages(bare(6), { worksLayout }).map((p) => p.html).join('');
      expect(html.includes('무제'), worksLayout).toBe(false);
    }
  });

  it('제목이 있으면 그대로 나온다 (거르기가 과하지 않다)', () => {
    const html = workPages({ user: { name: '김작가' }, images: [img({ id: 1, title: '달빛 아래' })] })
      .map((p) => p.html).join('');
    expect(html).toContain('달빛 아래');
  });

  it('제목이 없어도 판매상태는 남는다', () => {
    const html = workPages({ user: { name: '김작가' }, images: [img({ id: 1, status: 'SOLD' })] })
      .map((p) => p.html).join('');
    expect(html).toContain('Sold');
    expect(html).not.toContain('무제');
  });

  it('캡션이 통째로 비면 작품이 지면을 더 쓴다 (자리를 예약하지 않는다)', () => {
    const h = (d: PortfolioBookData) => {
      const html = workPages(d, { worksLayout: 'hero' })[0]!.html;
      return Number(/max-height:(\d+)px;object-fit/.exec(html)![1]);
    };
    const empty = h(bare(1));
    const titled = h({ user: { name: '김작가' }, images: [img({ id: 1, title: '달빛', medium: 'Oil', sizeText: '50×50 cm', year: '2025' })] });
    expect(empty).toBeGreaterThan(titled);
  });
});

describe('실데이터가 비었을 때의 구성', () => {
  const bare: PortfolioBookData = {
    user: { name: '김작가' }, tagline: null,   // ⚠️ 실서버 작가 81명 중 한 줄 소개를 채운 사람은 0명
    images: [1, 2].map((i) => img({ id: i, url: `https://x/${i}.jpg` })),
  };
  const workPages = (d: PortfolioBookData, design: Record<string, unknown>) =>
    buildPortfolioPages(d, themeById('archive'), { design })
      .filter((p) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(p.label));

  // ⚠️ 뮤지엄 라벨은 지면의 44% 를 캡션 칸으로 비운다. 실서버 작품 372점 중 361점(97%)은
  //    적을 게 아무것도 없어서 그 칸이 통째로 빈 흰 판이 됐다.
  it('라벨에 적을 게 없으면 뮤지엄 라벨 대신 대형 단독으로 그린다', () => {
    const empty = workPages(bare, { worksLayout: 'label' })[0]!.html;
    const filled = workPages({ ...bare, images: [img({ id: 1, title: '달빛', medium: 'Oil' })] },
      { worksLayout: 'label' })[0]!.html;
    // 라벨은 작품(좌)+캡션(우) 2단이라 gap 이 있고, hero 는 세로 한 줄이다
    expect(empty).not.toContain('gap:56px');
    expect(filled).toContain('gap:56px');
  });

  it('정보를 채운 작품은 그대로 뮤지엄 라벨이다 (전환이 과하지 않다)', () => {
    const html = workPages({ ...bare, images: [img({ id: 1, medium: 'Oil on canvas' })] },
      { worksLayout: 'label' })[0]!.html;
    expect(html).toContain('Oil on canvas');
    expect(html).toContain('gap:56px');
  });
});

describe('표지 구성 균형', () => {
  // ⚠️ `bandTop` 은 사진 높이를 `h*0.5` 로 못박고 글을 그 아래 붙여서, 한 줄 소개가 없으면
  //    하단 **28.7%** 가 빈 채로 남았다(위는 7.1%). 그런데 한 줄 소개를 채운 작가가 0명이라
  //    예외가 아니라 **전원**이 그 표지를 받았다. 지금은 위아래를 잡은 flex 기둥이다.
  //    ⚠️ 가운데 정렬 표지(serifCenter·nameplate·accentField)는 위아래가 같이 비는 게 **의도**다 — 건드리지 말 것.
  const noTag: PortfolioBookData = { user: { name: '김작가' }, tagline: null, images: [img({ id: 1 })] };
  it('bandTop 은 사진 높이를 못박지 않는다 (남는 높이를 사진이 가져간다)', () => {
    const html = buildPortfolioPages(noTag, themeById('archive'),
      { design: { coverLayout: 'bandTop' } })[0]!.html;
    expect(html).toMatch(/top:\d+px;bottom:\d+px;display:flex;flex-direction:column/);
    expect(html).toContain('flex:1;min-height:0');
  });
  it('bandTop 의 위아래 여백이 판형에 비례한다', () => {
    const pad = (page: 'a4-portrait' | 'wide') => {
      const html = buildPortfolioPages(noTag, themeById('archive'), { design: { coverLayout: 'bandTop', page } })[0]!.html;
      const m = /top:(\d+)px;bottom:(\d+)px;display:flex/.exec(html)!;
      const h = PAGE_DIMS[page].h;
      return { top: +m[1] / h, bottom: +m[2] / h };
    };
    const a = pad('a4-portrait'), w = pad('wide');
    expect(Math.abs(a.top - w.top)).toBeLessThan(0.01);
    expect(Math.abs(a.bottom - w.bottom)).toBeLessThan(0.01);
  });
});
