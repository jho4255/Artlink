/**
 * 포트폴리오 PDF 만들기 화면의 판단 (2026-10-03) — `lib/portfolioMaker.ts`
 *
 * 화면(React)은 jsdom 에서 레이아웃을 못 재므로, 화면이 내리는 판단을 순수 함수로 꺼내 여기서 잠근다.
 * 기하(첫 화면에 무엇이 들어오는가 · 눌리는가)는 `scratchpad/portfolio-maker/walk.js` 와 e2e 64 가 본다.
 */
import { describe, it, expect } from 'vitest';
import {
  CUSTOMIZE_TABS, customizeTabForPage, pageIndexForTab, statusLine, printedInfo, isDefaultSelection, nextSelectionName,
  directionMatches, previewScale, previewMaxWidth, EXPORT_LADDER, stepFactor, pickStep, formatMB, inAppBrowserName,
  TAB_KEYS, resetTab, applyDirection, PAPER_OPTIONS, cvItems,
} from '../lib/portfolioMaker';
import { DESIGN_DIRECTIONS } from '../lib/portfolioDirection';
import { buildPortfolioPages, normalizePdfDesign, themeById, type PortfolioBookData } from '../lib/portfolioFormats';
import type { PortfolioImage } from '../types';

const img = (id: number, extra: Partial<PortfolioImage> = {}): PortfolioImage =>
  ({ id, url: `https://x/${id}.jpg`, order: id, title: `작품 ${id}`, ...extra }) as PortfolioImage;
const book: PortfolioBookData = {
  user: { name: '홍길동', nickname: 'moon', email: 'hong@example.com', phone: '010-1234-5678', instagramUrl: 'https://instagram.com/hong_studio' },   // 홈페이지 주소(@moon.art)와 겹치지 않게 — 겹치면 '찍혔는가'를 글자로 가릴 수 없다
  homepageUrl: 'https://artlink.cc/@moon.art',
  statement: '작가노트', biography: '약력',
  career: { artFair: [], solo: [{ year: '2025', content: '개인전' }], group: [] },
  seriesInfo: [],
  images: Array.from({ length: 8 }, (_, i) => img(i + 1)),
};
const pagesOf = (design?: Record<string, unknown>) => buildPortfolioPages(book, themeById('archive'), { design });

describe('꾸미기 묶음 — 무엇을 고치는가로 나눈 다섯', () => {
  it("표지 · 작품 · 약력 · 색·글꼴 · 이름·연락처 — '작품 쪽' 이 아니라 '작품'(2026-10-03 사용자 지적)", () => {
    expect(CUSTOMIZE_TABS.map((t) => t.label)).toEqual(['표지', '작품', '약력', '색·글꼴', '이름·연락처']);
  });

  it('[약력] 탭은 작가노트·약력 중 책에서 먼저 나오는 쪽으로 간다 · 둘 다 껐으면 보던 자리', () => {
    const pages = pagesOf();
    const i = pageIndexForTab(pages, 'cv')!;
    expect(pages[i]!.part).toBe('statement');
    const noStatement = pagesOf({ cvShow: { statement: false } });
    expect(noStatement[pageIndexForTab(noStatement, 'cv')!]!.kind).toBe('cv');
    const none = pagesOf({ cvShow: { statement: false, bio: false, solo: false } });
    expect(pageIndexForTab(none, 'cv')).toBeNull();
  });

  it('★ 묶음을 열면 미리보기가 그 묶음이 바꾸는 쪽으로 간다', () => {
    const pages = pagesOf();
    expect(pageIndexForTab(pages, 'cover')).toBe(0);
    const w = pageIndexForTab(pages, 'works')!;
    expect(pages[w]!.kind).toBe('works');
    expect(pages.slice(0, w).every((p) => p.kind !== 'works')).toBe(true);   // 첫 작품 쪽
    const c = pageIndexForTab(pages, 'info')!;
    expect(pages[c]!.kind).toBe('contact');
    expect(c).toBe(pages.length - 1);
  });

  it('색·글꼴은 모든 쪽이 바뀌므로 보던 자리에 둔다', () => {
    expect(pageIndexForTab(pagesOf(), 'style')).toBeNull();
  });

  it('연락처를 전부 꺼서 마지막 장이 없으면 [이름·연락처] 는 이름이 찍히는 표지로 간다', () => {
    const pages = buildPortfolioPages(book, themeById('archive'), { design: { contact: { email: false, phone: false, instagram: false, web: false } } });
    expect(pages.some((p) => p.kind === 'contact')).toBe(false);
    expect(pageIndexForTab(pages, 'info')).toBe(0);
  });

  it('미리보기의 쪽 → 그 쪽을 고치는 묶음', () => {
    expect(customizeTabForPage('cover')).toBe('cover');
    expect(customizeTabForPage('works')).toBe('works');
    expect(customizeTabForPage('index')).toBe('works');
    expect(customizeTabForPage('prose')).toBe('works');            // 시리즈 소개·작품 이야기
    expect(customizeTabForPage('prose', 'statement')).toBe('cv');   // 작가노트
    expect(customizeTabForPage('contact')).toBe('info');
    expect(customizeTabForPage('cv')).toBe('cv');
  });

  it('쪽이 하나도 없으면 데려갈 곳이 없다', () => {
    expect(pageIndexForTab([], 'cover')).toBeNull();
    expect(pageIndexForTab([], 'works')).toBeNull();
    expect(pageIndexForTab([], 'info')).toBeNull();
  });
});

describe('머리의 상태 줄', () => {
  it('"작품 N점 · M쪽" 한 줄 — 글 0쪽·CV 1쪽 같은 말은 쓰지 않는다', () => {
    expect(statusLine(8, 7)).toBe('작품 8점 · 7쪽');
    expect(statusLine(8, 7)).not.toMatch(/CV|글/);
  });
});

describe('이렇게 실립니다 — 저장하기 전에 이름·연락처를 보여 준다', () => {
  const info = (design?: Record<string, unknown>, data = book) => printedInfo(data, normalizePdfDesign(design ?? null));

  it('★ 기본: 이름은 실명, 연락처는 전부', () => {
    const i = info();
    expect(i.name).toBe('홍길동');
    expect(i.canChooseName).toBe(true);
    expect(i.contacts.map((c) => [c.key, c.printed])).toEqual([['email', true], ['phone', true], ['instagram', true], ['web', true]]);
    expect(i.printedText).toBe('이메일 · 전화번호 · 인스타그램 · 홈페이지 주소·QR');
  });

  it('닉네임을 고르면 이름이 닉네임', () => {
    expect(info({ nameSource: 'nickname' }).name).toBe('moon');
  });

  it('닉네임이 없거나 실명과 같으면 고르는 줄이 없다', () => {
    expect(info(undefined, { ...book, user: { ...book.user, nickname: null } }).canChooseName).toBe(false);
    expect(info(undefined, { ...book, user: { ...book.user, nickname: '홍길동' } }).canChooseName).toBe(false);
  });

  it('끈 항목은 실리지 않는다고 말한다', () => {
    const i = info({ contact: { phone: false } });
    expect(i.contacts.find((c) => c.key === 'phone')).toMatchObject({ enabled: false, printed: false, value: '010-1234-5678' });
    expect(i.printedText).toBe('이메일 · 인스타그램 · 홈페이지 주소·QR');
  });

  it('프로필에 없는 값은 켜 둬도 실리지 않는다 — 화면이 "프로필에서 입력" 을 보여 줄 근거', () => {
    const i = info(undefined, { ...book, user: { ...book.user, phone: null, instagramUrl: '' } });
    expect(i.contacts.find((c) => c.key === 'phone')).toMatchObject({ value: '', enabled: true, printed: false });
    expect(i.contacts.find((c) => c.key === 'instagram')).toMatchObject({ value: '', printed: false });
    expect(i.printedText).toBe('이메일 · 홈페이지 주소·QR');
  });

  it('★ 화면이 말한 것과 마지막 장에 찍힌 것이 같다 (같은 출처)', () => {
    for (const contact of [{}, { phone: false }, { email: false, web: false }, { instagram: false }]) {
      const design = normalizePdfDesign({ contact });
      const last = buildPortfolioPages(book, themeById('archive'), { design }).find((p) => p.kind === 'contact')!;
      for (const c of printedInfo(book, design).contacts) {
        expect(last.html.includes(c.value), `${JSON.stringify(contact)} ${c.key}`).toBe(c.printed);
      }
    }
  });
});

describe('구성(작품 고르기)', () => {
  it('전체를 홈페이지 순서 그대로 고르면 따로 저장할 구성이 아니다', () => {
    expect(isDefaultSelection([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isDefaultSelection([1, 2, 3], [1, 3, 2])).toBe(false);   // 순서를 바꿨다
    expect(isDefaultSelection([1, 2, 3], [1, 2])).toBe(false);      // 일부만
    expect(isDefaultSelection([], [])).toBe(true);
  });

  it('새 구성의 이름은 "제출용 1" 부터 — 비어 있는 가장 작은 번호', () => {
    expect(nextSelectionName([])).toBe('제출용 1');
    expect(nextSelectionName([{ name: '제출용 1' }])).toBe('제출용 2');
    expect(nextSelectionName([{ name: '제출용 2' }])).toBe('제출용 1');
    expect(nextSelectionName([{ name: '제출용 1' }, { name: '공모용' }, { name: '제출용 2' }])).toBe('제출용 3');
    expect(nextSelectionName([{ name: '새 버전' }])).toBe('제출용 1');   // 옛 이름과는 무관
  });
});

describe('디자인 줄의 ✓ — 지금 모양이 그 방향 그대로일 때만', () => {
  const gallery = DESIGN_DIRECTIONS.find((d) => d.key === 'gallery')!;
  const picked = normalizePdfDesign({ ...gallery.design, direction: gallery.key, auto: true });

  it('방향을 고른 직후에는 그 방향만 ✓', () => {
    expect(DESIGN_DIRECTIONS.filter((d) => directionMatches(picked, d)).map((d) => d.key)).toEqual(['gallery']);
  });

  it('★ 고른 뒤 표지·색을 직접 바꾸면 ✓ 가 사라진다 (카드와 화면이 다른 모양이 되지 않게)', () => {
    expect(directionMatches({ ...picked, coverLayout: 'grid2x2' }, gallery)).toBe(false);
    expect(directionMatches({ ...picked, bg: 'white' }, gallery)).toBe(false);
    expect(directionMatches({ ...picked, direction: 'gallery', font: 'gothic' }, gallery)).toBe(false);
  });

  it('작품 배치를 한 가지로 고정하면 ✓ 가 아니다 · 자동 배치에서는 worksLayout 을 보지 않는다', () => {
    expect(directionMatches({ ...picked, auto: false }, gallery)).toBe(false);
    expect(directionMatches({ ...picked, worksLayout: 'grid' }, gallery)).toBe(true);
  });

  it('아무것도 고르지 않은 기본 모양은 어느 방향과도 같지 않다', () => {
    const def = normalizePdfDesign(null);
    expect(DESIGN_DIRECTIONS.some((d) => directionMatches(def, d))).toBe(false);
  });

  it('이름·연락처는 방향과 무관하다 — 바꿔도 ✓ 는 남는다', () => {
    expect(directionMatches({ ...picked, nameSource: 'nickname', contact: { email: true, phone: false, instagram: true, web: true } }, gallery)).toBe(true);
  });
});

describe('미리보기 크기', () => {
  it('세로 판형은 600px 까지, 가로 판형은 840px 까지', () => {
    expect(previewMaxWidth(1000, 1414)).toBe(600);
    expect(previewMaxWidth(1414, 1000)).toBe(840);
    expect(previewMaxWidth(1600, 900)).toBe(840);
  });

  it('★ 넓은 화면에서 한 쪽이 600px — 예전(높이 맞춤 339px)보다 크다', () => {
    expect(Math.round(1000 * previewScale(1000, 1414, 960))).toBe(600);
  });

  it('좁은 화면에서는 칸 폭에 맞춘다(가로로 넘치지 않는다)', () => {
    expect(Math.round(1000 * previewScale(1000, 1414, 364))).toBe(364);
    expect(Math.round(1000 * previewScale(1000, 1414, 272))).toBe(272);
    expect(Math.round(1414 * previewScale(1414, 1000, 364))).toBe(364);
  });

  it('★ 꾸미기를 열면 한 쪽이 통째로 그 높이 안에 들어온다', () => {
    const s = previewScale(1000, 1414, 576, 600);
    expect(1414 * s).toBeLessThanOrEqual(600.01);
    expect(1000 * s).toBeLessThanOrEqual(576);
    // 가로 판형은 폭이 먼저 걸린다
    const l = previewScale(1414, 1000, 364, 300);
    expect(1000 * l).toBeLessThanOrEqual(300.01);
    expect(1414 * l).toBeLessThanOrEqual(364.01);
  });

  it('칸 폭을 아직 모르면(0) 작게 시작한다 — 0 배율로 사라지지 않는다', () => {
    expect(previewScale(1000, 1414, 0)).toBeGreaterThan(0);
    expect(previewScale(1000, 1414, 600, 0)).toBeCloseTo(0.6);
  });
});

describe('저장 용량 — 넘칠 때만 줄인다', () => {
  const MB = 1048576;
  const BUDGET = 9.4 * MB;

  it('사다리는 내려갈수록 작아진다 — 0단계가 기준(배율 1)', () => {
    expect(stepFactor(0)).toBe(1);
    for (let i = 1; i < EXPORT_LADDER.length; i++) expect(stepFactor(i)).toBeLessThan(stepFactor(i - 1));
    expect(stepFactor(EXPORT_LADDER.length - 1)).toBeLessThan(0.3);   // 마지막 단계는 4분의 1 아래
    expect(stepFactor(99)).toBe(stepFactor(EXPORT_LADDER.length - 1)); // 범위를 벗어나도 안전
  });

  it('★ 예산 안이면 줄이지 않는다', () => {
    expect(pickStep(3 * MB, BUDGET)).toBe(0);
    expect(pickStep(BUDGET, BUDGET)).toBe(0);
  });

  it('★ 넘치면 예산에 들어올 단계를 한 번에 고른다 (한 칸씩 내려가며 다시 굽지 않는다)', () => {
    for (const mb of [10, 12, 15, 20, 30]) {
      const step = pickStep(mb * MB, BUDGET);
      expect(step, `${mb}MB`).toBeGreaterThan(0);
      if (step < EXPORT_LADDER.length - 1) {
        expect(mb * MB * stepFactor(step), `${mb}MB 의 추정 용량`).toBeLessThanOrEqual(BUDGET);
        // 그리고 한 칸 덜 내려가면 여유(8%)를 못 맞춘다 — 필요 이상으로 줄이지 않는다
        expect(mb * MB * stepFactor(step - 1), `${mb}MB 한 칸 위`).toBeGreaterThan(BUDGET * 0.92);
      }
    }
    expect(pickStep(12 * MB, BUDGET)).toBeLessThan(pickStep(30 * MB, BUDGET));
  });

  it('어느 단계로도 안 되면 마지막 단계 — 그래도 저장은 된다', () => {
    expect(pickStep(200 * MB, BUDGET)).toBe(EXPORT_LADDER.length - 1);
  });

  it('용량 표기 — 0.0MB 로 보이지 않게', () => {
    expect(formatMB(6.24 * MB)).toBe('6.2MB');
    expect(formatMB(1000)).toBe('0.1MB');
  });
});

describe('앱 안에서 열린 브라우저 — 파일 저장이 막힐 수 있다고 미리 알린다', () => {
  it('카카오톡·인스타그램·네이버 앱을 알아본다', () => {
    expect(inAppBrowserName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5')).toBe('카카오톡');
    expect(inAppBrowserName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Instagram 310.0.0.0')).toBe('인스타그램');
    expect(inAppBrowserName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.0.0)')).toBe('네이버 앱');
  });

  it('평범한 크롬·사파리는 아니다', () => {
    expect(inAppBrowserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')).toBeNull();
    expect(inAppBrowserName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBeNull();
    expect(inAppBrowserName('')).toBeNull();
    expect(inAppBrowserName(undefined)).toBeNull();
  });
});

/** 한 탭의 옵션은 그 쪽만 바꾼다 · 용지는 따로 (2026-10-03 사용자 결정) */
describe('탭마다 따로 · 용지는 따로', () => {
  const ALL = Object.keys(normalizePdfDesign(null));

  it('★ 디자인 값은 전부 어느 한 탭에 속한다(용지·방향 이름 빼고) — 빠지면 어느 탭의 [처음 상태로] 도 그 값을 못 되돌린다', () => {
    const owned = Object.values(TAB_KEYS).flat() as string[];
    expect(new Set(owned).size).toBe(owned.length);                       // 두 탭에 걸친 값이 없다
    expect([...owned].sort()).toEqual(ALL.filter((k) => k !== 'page' && k !== 'direction').sort());
  });

  it('★ [처음 상태로] 는 그 탭의 값만 되돌린다 — 다른 탭·용지는 그대로', () => {
    const mine = normalizePdfDesign({
      page: 'a4-landscape', bg: 'ink', ink: 'white', font: 'plex',
      coverLayout: 'split', coverYear: false, worksLayout: 'grid', auto: false, proseAlign: 'left',
      cvPosition: 'before', nameSource: 'nickname', contact: { phone: false },
    });
    const cover = resetTab(mine, 'cover');
    expect(cover.coverLayout).toBe('bandTop');
    expect(cover.coverYear).toBe(true);
    for (const k of ['page', 'bg', 'ink', 'font', 'worksLayout', 'auto', 'proseAlign', 'cvPosition', 'nameSource', 'contact'] as const) expect(cover[k], k).toEqual(mine[k]);
    const style = resetTab(mine, 'style');
    expect([style.bg, style.font]).toEqual(['white', 'myeongjo']);
    expect(style.page).toBe('a4-landscape');
    expect(style.coverLayout).toBe('split');
    const cv = resetTab(mine, 'cv');
    expect([cv.cvPosition, cv.proseAlign]).toEqual(['after', 'justify']);
    expect(cv.worksLayout).toBe('grid');
  });

  it('★ 디자인 카드는 용지를 바꾸지 않는다 — 고른 세로 A4 가 말없이 가로로 바뀌던 것', () => {
    const lookbook = DESIGN_DIRECTIONS.find((d) => d.design.page === 'a4-landscape')!;
    const d = applyDirection(normalizePdfDesign({ page: 'a4-portrait' }), lookbook);
    expect(d.page).toBe('a4-portrait');
    expect(d.coverLayout).toBe(lookbook.design.coverLayout);
    expect(d.direction).toBe(lookbook.key);
    expect(d.auto).toBe(true);
    // 용지가 달라도 '그 디자인' 이라는 ✓ 는 맞다
    expect(directionMatches(d, lookbook)).toBe(true);
    // 이름·연락처는 디자인이 아니다
    const named = applyDirection(normalizePdfDesign({ nameSource: 'nickname', contact: { phone: false } }), lookbook);
    expect(named.nameSource).toBe('nickname');
    expect(named.contact.phone).toBe(false);
  });

  it('용지는 세 가지 — 세로 A4 가 먼저', () => {
    expect(PAPER_OPTIONS.map((o) => o.label)).toEqual(['세로 A4', '가로 A4', '와이드 16:9']);
    expect(PAPER_OPTIONS[0]!.key).toBe(normalizePdfDesign(null).page);
  });

  it('[약력] 싣는 항목 — 적어 둔 게 있는지 · 얼마나 · 켜 두었는지(엔진과 같은 기준)', () => {
    const items = cvItems({
      statement: '  노트  ', biography: '',
      career: { solo: [{ year: '2025', content: '개인전' }, { year: '', content: '' }], group: [], artFair: [], award: [{ year: '2020', content: '' }] },
    }, normalizePdfDesign({ cvShow: { award: false } }));
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(items.map((i) => i.label)).toEqual(['작가노트', '약력 글', '학력', '개인전', '단체전', '아트페어', '수상 및 선정']);
    expect(by.statement).toMatchObject({ has: true, amount: '2자', enabled: true });
    expect(by.bio).toMatchObject({ has: false, amount: '' });
    expect(by.solo).toMatchObject({ has: true, amount: '1줄' });          // 빈 줄은 세지 않는다
    expect(by.award).toMatchObject({ has: true, amount: '1줄', enabled: false });   // 연도만 적어도 엔진은 찍는다
  });
});

