/**
 * 포트폴리오 포맷 — 페이지 구성 규칙.
 *
 * 렌더 결과(그림)는 눈으로 봐야 하지만, "무엇이 몇 장 나오는가"는 순수 함수라 여기서 잠근다.
 * 특히 캡션(제목/재료/크기/연도)이 페이지에 실제로 들어가는지 — 이게 빠지면 포맷을 만든 의미가 없다.
 */
import { describe, it, expect } from 'vitest';
import {
  PORTFOLIO_THEMES, buildPortfolioPages, bookImageUrls, estimateParaH, splitCvColumns, splitParagraphs, themeById,
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

  it('순서: 표지 → 작가노트 → 시리즈 소개 → 작품 → CV → 연락처', () => {
    expect(labels(base)).toEqual(['표지', '작가노트', '산 소개', '산', '작품', 'CV', '연락처']);
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

describe('포맷별 작품 배치', () => {
  const many = Array.from({ length: 6 }, (_, i) => img({ id: i + 1, series: 'S', title: `작품 ${i + 1}` }));
  const d: PortfolioBookData = { ...base, seriesInfo: [], images: many };

  it('작품/쪽 수만큼 나눠 담는다 — B 3점, A·D 2점, C 1점', () => {
    const count = (id: string) => buildPortfolioPages(d, themeById(id)).filter((p) => p.label === 'S').length;
    expect(count('studio')).toBe(2);   // 6 / 3
    expect(count('gallery')).toBe(3);  // 6 / 2
    expect(count('archive')).toBe(3);
    expect(count('story')).toBe(6);    // 1점씩
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

  it('포맷 C: 긴 작품 설명은 이어지는 이야기 페이지로 넘어간다 (잘리지 않음)', () => {
    const d: PortfolioBookData = {
      ...base, seriesInfo: [],
      images: [img({ id: 1, title: '작품 A', description: long(8) })],
    };
    const ps = buildPortfolioPages(d, themeById('story'));
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
