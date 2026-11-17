/**
 * 작가·갤러리 홈페이지 개편 (2026-11-14, CLAUDE.md 규칙 82) — 순수 판단과 서버와 같아야 하는 값.
 *  · lib/homepageSite.ts — 표지 비율 · '전시 중' 띠 · 지도/전화 · 문의 초안 · 주인 안내 · 서버와 같은 글자 수
 *  · lib/siteMode.ts — 어디가 홈페이지('내 사이트' 모드)인가 · 소개 팝업과 같은 답
 *  · lib/homepageTabs.ts — [소식] 탭 · 머리 메뉴와 탭 막대가 같은 목록
 *  · lib/homepageTheme.ts — 웹 전용 키(showNow)를 PDF 저장이 들고 간다
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COVER_GRID, GALLERY_OPEN_HOURS_MAX, INQUIRY_CONTACT_MAX, INQUIRY_MESSAGE_MAX, INQUIRY_NAME_MAX,
  coverShape, inquiryDraft, isContactLike, mapHref, markSiteNoticeSeen, monthDayKst, nowShowingHref, nowShowingParts, siteNoticeSeen, telHref,
} from '@/lib/homepageSite';
import { HOMEPAGE_PANEL_MIN_H, isHomepagePath, liftToHomepageTabs, SITE_HEADER_H } from '@/lib/siteMode';
import { introAllowedAt } from '@/lib/guestIntro';
import { homepageTabs, homepageTabsFor } from '@/lib/homepageTabs';
import { keepWebOnlyKeys, showNowFrom, WEB_ONLY_KEYS } from '@/lib/homepageTheme';
import type { NowShowing } from '@/types';

const backend = (p: string) => readFileSync(resolve(__dirname, '../../../backend/src', p), 'utf8');
const num = (srcText: string, name: string) => {
  const m = srcText.match(new RegExp(`export const ${name} = ([\\d_]+)`));
  if (!m) throw new Error(`${name} 을 서버 소스에서 못 찾았다`);
  return Number(m[1]!.replace(/_/g, ''));
};

describe('서버와 같은 값 — 다르면 화면이 통과시킨 것을 서버가 막는다', () => {
  it('관람 시간 80자 · 문의 이름 40 · 연락처 100 · 내용 1,000', () => {
    expect(GALLERY_OPEN_HOURS_MAX).toBe(num(backend('routes/gallery.ts'), 'GALLERY_OPEN_HOURS_MAX'));
    const inq = backend('lib/homepageInquiry.ts');
    expect(INQUIRY_NAME_MAX).toBe(num(inq, 'INQUIRY_NAME_MAX'));
    expect(INQUIRY_CONTACT_MAX).toBe(num(inq, 'INQUIRY_CONTACT_MAX'));
    expect(INQUIRY_MESSAGE_MAX).toBe(num(inq, 'INQUIRY_MESSAGE_MAX'));
  });
  it('연락처 모양 — 서버 isContactLike 와 같은 규칙(정규식 그대로)', () => {
    const fe = readFileSync(resolve(__dirname, '../lib/homepageSite.ts'), 'utf8');
    const be = backend('lib/homepageInquiry.ts');
    for (const re of ['/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/', '/^[+(\\d][\\d\\s()\\-.]*$/', '>= 8']) {
      expect(fe, re).toContain(re);
      expect(be, re).toContain(re);
    }
    for (const ok of ['a@b.co', '010-1234-5678', '+82 10 1234 5678', '(02) 123-4567']) expect(isContactLike(ok), ok).toBe(true);
    for (const bad of ['', 'me@x', '1234', '그냥 글자', '010-12']) expect(isContactLike(bad), bad).toBe(false);
  });
});

describe('표지 — 대표작 모양으로 두 칸 비율', () => {
  it('가로 그림은 그림 칸을 넓게, 세로 그림은 글 칸을 넓게, 모르면 반반', () => {
    expect(coverShape(1600, 900)).toBe('landscape');
    expect(coverShape(800, 1100)).toBe('portrait');
    expect(coverShape(1000, 1000)).toBe('square');
    expect(coverShape(null, null)).toBe('square');
    expect(coverShape(1199, 1000)).toBe('square');
    // Tailwind 가 읽는 완성된 클래스 문자열이어야 한다(조립하면 빌드에서 빠진다)
    for (const v of Object.values(COVER_GRID)) expect(v).toMatch(/^md:grid-cols-\[minmax\(0,\d+fr\)_minmax\(0,\d+fr\)\]$/);
  });
});

describe("'전시 중' 띠", () => {
  const base: NowShowing = { state: 'ongoing', exhibitionId: 7, title: '빛의 결', startDate: '2026-11-04T00:00:00.000Z', endDate: '2026-11-20T00:00:00.000Z', gallery: { id: 3, name: '갤러리 한켠', handle: 'hankyeon' } };
  it('날짜는 KST 달력으로 — UTC 자정 저장값 · KST 자정 넘긴 시각', () => {
    expect(monthDayKst('2026-11-20T00:00:00.000Z')).toBe('11월 20일');
    expect(monthDayKst('2026-11-19T15:30:00.000Z')).toBe('11월 20일');   // KST 11/20 00:30
    expect(monthDayKst(null)).toBe('');
    expect(monthDayKst('nope')).toBe('');
  });
  it('진행 중은 "…까지", 예정은 "…부터" · 상태 글자는 따로(강조색은 상태에만)', () => {
    expect(nowShowingParts(base)).toEqual({ label: '전시 중', title: '빛의 결', detail: '갤러리 한켠 · 11월 20일까지' });
    expect(nowShowingParts({ ...base, state: 'upcoming' })).toEqual({ label: '전시 예정', title: '빛의 결', detail: '갤러리 한켠 · 11월 4일부터' });
    expect(nowShowingParts({ ...base, gallery: null }).detail).toBe('11월 20일까지');
  });
  it('누르면 갤러리 홈페이지(핸들 우선) — 갤러리 없이 연 공모면 공모 상세', () => {
    expect(nowShowingHref(base)).toBe('/@hankyeon');
    expect(nowShowingHref({ ...base, gallery: { id: 3, name: 'g', handle: null } })).toBe('/galleries/3');
    expect(nowShowingHref({ ...base, gallery: null })).toBe('/exhibitions/7');
  });
});

describe('방문 정보 · 문의 초안 · 주인 안내', () => {
  it('지도는 주소 검색 · 전화는 숫자와 + 만', () => {
    expect(mapHref(' 서울 종로구 한켠길 12 ')).toBe(`https://map.kakao.com/link/search/${encodeURIComponent('서울 종로구 한켠길 12')}`);
    expect(telHref('02-123-4567')).toBe('tel:021234567');
    expect(telHref('+82 (10) 1234-5678')).toBe('tel:+821012345678');
  });
  it('작품 문의 초안 — 제목이 있으면 〈제목〉, 없으면 그냥 작품 문의, 홈페이지 문의면 빈칸', () => {
    expect(inquiryDraft({ title: ' 조용한 오후 ' })).toBe('〈조용한 오후〉 작품 문의드립니다.');
    expect(inquiryDraft({ title: '' })).toBe('작품 문의드립니다.');
    expect(inquiryDraft(null)).toBe('');
  });
  describe('주인 안내는 계정마다 한 번', () => {
    beforeEach(() => localStorage.clear());
    it('닫으면 그 계정만 다시 안 뜬다', () => {
      expect(siteNoticeSeen(7)).toBe(false);
      markSiteNoticeSeen(7);
      expect(siteNoticeSeen(7)).toBe(true);
      expect(siteNoticeSeen(8)).toBe(false);
    });
  });
});

describe("'내 사이트' 모드 — 어디가 홈페이지인가(lib/siteMode.ts)", () => {
  it('작가 /@핸들 · /portfolio/:id · 갤러리 /galleries/:id — 등록 화면·목록·다른 한 조각 주소는 아니다', () => {
    for (const p of ['/@my.studio', '/@my.studio/', '/portfolio/7', '/galleries/3', '/galleries/3/']) expect(isHomepagePath(p), p).toBe(true);
    for (const p of ['/', '/galleries', '/galleries/new', '/artists', '/portfolio', '/foo', '/@a/b', '/mypage', '/feed']) expect(isHomepagePath(p), p).toBe(false);
  });
  it('★ 소개 팝업은 홈페이지에 안 뜬다 — 같은 판정을 쓴다(한쪽만 고치면 갈라진다)', () => {
    for (const p of ['/@my.studio', '/portfolio/7', '/galleries/3']) expect(introAllowedAt(p), p).toBe(false);
    expect(readFileSync(resolve(__dirname, '../lib/guestIntro.ts'), 'utf8')).toContain('isHomepagePath(p)');
  });
  it('머리 높이 56 / lg 72 — 클래스(h-14 · lg:h-[72px] · top-14 · lg:top-[72px])와 같다', () => {
    expect(SITE_HEADER_H).toEqual({ base: 56, lg: 72 });
    const header = readFileSync(resolve(__dirname, '../components/homepage/SiteHeader.tsx'), 'utf8');
    expect(header).toContain('h-14');
    expect(header).toContain('lg:h-[72px]');
    const view = readFileSync(resolve(__dirname, '../components/shared/HomepageView.tsx'), 'utf8');
    expect(view).toContain('sticky top-14 z-30');
    expect(view).toContain('lg:top-[72px]');
  });
});

describe('[소식] 탭 (lib/homepageTabs)', () => {
  const full = { workCount: 3, hasNote: true, hasCv: true, hasFile: false, guestbook: { count: 0 } };
  it('보이는 소식이나 하이라이트가 있을 때만 · 작품 다음', () => {
    expect(homepageTabs({ ...full, news: { storyCount: 0, highlightCount: 0 } }).map((t) => t.id)).not.toContain('news');
    expect(homepageTabs({ ...full, news: { storyCount: 2 } }).map((t) => t.id)).toEqual(['works', 'news', 'note', 'cv', 'guestbook']);
    expect(homepageTabs({ ...full, news: { highlightCount: 1 } }).map((t) => t.id)).toContain('news');
    // 편집 미리보기(news 없음)에는 없다
    expect(homepageTabs(full).map((t) => t.id)).not.toContain('news');
  });
  it('homepageTabsFor — 데이터에서 같은 목록(머리 메뉴와 탭 막대가 이걸 같이 쓴다)', () => {
    const d = { images: [{}, {}], statement: '노트', biography: '', career: null, portfolioFileUrl: null };
    expect(homepageTabsFor(d, { news: { storyCount: 1 }, guestbook: { count: 2 } }).map((t) => t.id)).toEqual(['works', 'news', 'note', 'guestbook']);
    expect(homepageTabsFor(d).map((t) => t.id)).toEqual(['works', 'note']);
    expect(homepageTabsFor({ ...d, portfolioFileUrl: 'javascript:alert(1)' }).map((t) => t.id)).not.toContain('file');
  });
});

describe("웹 전용 키 — '전시 중' 띠(showNow)", () => {
  it('기본은 켜짐 · 끈 경우만 false', () => {
    expect(showNowFrom(null)).toBe(true);
    expect(showNowFrom({})).toBe(true);
    expect(showNowFrom({ showNow: true })).toBe(true);
    expect(showNowFrom({ showNow: false })).toBe(false);
  });
  it('★ PDF 저장이 designConfig 를 통째로 바꿔도 showNow 를 들고 간다(규칙 49 ②)', () => {
    expect(WEB_ONLY_KEYS).toContain('showNow');
    const next = keepWebOnlyKeys({ bg: 'sand' } as Record<string, unknown>, { showNow: false, heroImageId: 3 }) as Record<string, unknown>;
    expect(next).toMatchObject({ bg: 'sand', showNow: false, heroImageId: 3 });
  });
  it('서버도 끈 경우만 숨긴다(lib/nowShowing.ts showNowEnabled)', () => {
    expect(backend('lib/nowShowing.ts')).toMatch(/o\.showNow === false/);
  });
});

describe('탭을 누르면 그 탭 내용으로 내려간다 — liftToHomepageTabs (2026-11-15 사용자 지적)', () => {
  let anchorTop = 0;
  const scrollTo = vi.fn();
  beforeEach(() => {
    document.body.innerHTML = '<div id="hp-tabs"></div><div id="gallery-tabs"></div>';
    for (const id of ['hp-tabs', 'gallery-tabs']) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ top: anchorTop } as DOMRect);
    }
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    scrollTo.mockClear();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('★ 표지를 보던 중(탭 줄이 화면 아래)에도 내려간다 — 탭 줄이 머리(56px) 밑에 붙게', () => {
    anchorTop = 600;
    liftToHomepageTabs();
    expect(scrollTo).toHaveBeenCalledWith({ top: 300 + 600 - 56 });
  });
  it('탭 줄을 지나 내려가 있으면 그 탭의 첫머리로 올라온다', () => {
    anchorTop = -900;
    liftToHomepageTabs('gallery-tabs');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });   // 300 - 900 - 56 < 0 → 0
    anchorTop = -200;
    liftToHomepageTabs('gallery-tabs');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300 - 200 - 56 });
  });
  it('이미 붙어 있으면 움직이지 않는다 · PC 는 머리 72px', () => {
    anchorTop = 56;
    liftToHomepageTabs();
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    anchorTop = 500;
    liftToHomepageTabs();
    expect(scrollTo).toHaveBeenCalledWith({ top: 300 + 500 - 72 });
  });
  it('짧은 탭이어도 붙일 수 있게 내용 칸의 최소 높이 = 화면 − 머리 − 탭 줄(완성된 클래스 문자열)', () => {
    expect(HOMEPAGE_PANEL_MIN_H).toBe('min-h-[calc(100svh-101px)] lg:min-h-[calc(100svh-117px)]');
    expect(56 + 45).toBe(101);
    expect(SITE_HEADER_H.lg + 45).toBe(117);
  });
});
