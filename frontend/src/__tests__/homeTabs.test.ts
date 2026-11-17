/**
 * 휴대폰·앱 홈의 탭 (2026-11-14 사용자 결정) — `lib/homeTabs.ts` · `components/home/HomeTabs.tsx`.
 * 배너 아래 칸들을 탭 한 줄로: ArtWorks · ArtStory · 인기글 · 마감임박 공모. 진행중인 전시·주목할 갤러리는 '일단' 뺐다(PC 에만).
 * ArtStory 칸은 카드 두 줄(한 줄이면 아래가 허했다 — 사용자 지적).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HOME_TABS, HOME_TABS_MEDIA, visibleHomeTabs, resolveHomeTab, homeTabFromState } from '@/lib/homeTabs';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf-8');
const ids = (tabs: readonly { id: string }[]) => tabs.map((t) => t.id);

describe('탭 순서·이름', () => {
  it('★ 사용자가 정한 순서 — ArtWorks · ArtStory · 인기글 · 마감임박 공모', () => {
    expect(HOME_TABS.map((t) => t.label)).toEqual(['ArtWorks', 'ArtStory', '인기글', '마감임박 공모']);
  });
  it('★ 진행중인 전시·주목할 갤러리는 탭에 없다(일단 뺐다 — PC 에만)', () => {
    expect(HOME_TABS.map((t) => t.label)).not.toContain('진행중인 전시');
    expect(HOME_TABS.map((t) => t.label)).not.toContain('주목할 갤러리');
  });
  it('휴대폰 폭(Tailwind md 아래)에서만', () => {
    expect(HOME_TABS_MEDIA).toBe('(max-width: 767px)');
  });
});

describe('visibleHomeTabs — 빈 칸은 탭도 없다', () => {
  it('답이 오기 전: 늘 있는 칸만 보인다(빌 수 있는 칸은 나타났다 사라지지 않게 기다린다)', () => {
    expect(ids(visibleHomeTabs({}))).toEqual(['works', 'story', 'popular']);
  });
  it('마감임박 공모는 내용이 있다고 알려 온 뒤에 생긴다', () => {
    expect(ids(visibleHomeTabs({ closing: false }))).toEqual(['works', 'story', 'popular', 'closing']);
    expect(ids(visibleHomeTabs({ closing: true }))).toEqual(['works', 'story', 'popular']);
  });
  it('늘 있는 칸도 비었다고 알려 오면 빠진다(공개 작품 0점 · 소식 줄 실패)', () => {
    expect(ids(visibleHomeTabs({ works: true, story: true }))).toEqual(['popular']);
  });
});

describe('resolveHomeTab — 열어 둘 탭', () => {
  const all = visibleHomeTabs({ closing: false });
  it('처음엔 첫 탭(ArtWorks)', () => {
    expect(resolveHomeTab(undefined, all)).toBe('works');
    expect(resolveHomeTab(null, all)).toBe('works');
  });
  it('뒤로 와서 되살린 탭이 줄에 있으면 그 탭', () => {
    expect(resolveHomeTab('closing', all)).toBe('closing');
  });
  it('줄에 없는 탭(비었거나 모르는 값)이면 첫 탭', () => {
    expect(resolveHomeTab('closing', visibleHomeTabs({}))).toBe('works');
    expect(resolveHomeTab('shows', all)).toBe('works');
    expect(resolveHomeTab('galleries', all)).toBe('works');
    expect(resolveHomeTab(3, all)).toBe('works');
    expect(resolveHomeTab('popular', visibleHomeTabs({ works: true }))).toBe('popular');
    expect(resolveHomeTab(undefined, visibleHomeTabs({ works: true }))).toBe('story');
  });
  it('기록 state 에서 읽는다 — 다른 값이 함께 있어도 된다', () => {
    expect(homeTabFromState(null)).toBeUndefined();
    expect(homeTabFromState('story')).toBeUndefined();
    expect(homeTabFromState({ homeTab: 'story', from: '/x' })).toBe('story');
  });
});

describe('소스 가드', () => {
  const home = src('pages/HomePage.tsx');
  const tabs = src('components/home/HomeTabs.tsx');
  it('★ 홈은 휴대폰 폭이면 탭, 아니면 지금 칸들 — 두 벌을 그려 놓고 CSS 로 감추지 않는다', () => {
    expect(home).toMatch(/const phone = useMediaQuery\(HOME_TABS_MEDIA\)/);
    expect(home).toMatch(/\{phone \? \(\s*<HomeTabs \/>/);
    expect(home).toMatch(/data-testid="home-widgets"/); // PC 는 그대로
    expect(home).toMatch(/<OngoingShows \/>/);
  });
  it('★ 탭 화면에는 진행중인 전시·주목할 갤러리가 없다', () => {
    expect(tabs).not.toMatch(/OngoingShows/);
    expect(tabs).not.toMatch(/GalleryOfMonth/);
    expect(home).toMatch(/<GalleryOfMonthSection variant="rail" \/>/); // PC 는 그대로
  });
  it('★ 칸은 모두 띄워 두고 고른 칸만 보인다(hidden) — 탭을 오가도 작품이 바뀌지 않게', () => {
    expect(tabs).toMatch(/hidden=\{id !== active\}/);
    for (const c of ['<ArtWorks bare', '<StoryRail bare', '<PopularPosts bare', '<ClosingSoonExhibitions bare']) {
      expect(tabs).toContain(c);
    }
  });
  it('★ 고른 탭은 주소가 아니라 기록 state 에 replace 로 둔다', () => {
    expect(tabs).toMatch(/replace: true, state: \{ \.\.\.prev, homeTab: id \}/);
    expect(tabs).not.toMatch(/setSearchParams|\?tab=/);
  });
  it('탭 줄은 다른 페이지 탭과 같은 부품(PageTabBar, 상단바 아래 붙는다)', () => {
    expect(tabs).toMatch(/<PageTabBar tabs=\{tabs\} active=\{active\} onSelect=\{select\} idPrefix="home" label="홈" \/>/);
  });
  it('★ ArtStory 칸은 카드 두 줄 — 위→아래→다음 칸, 두 줄이 함께 옆으로 밀린다(PC 는 한 줄 그대로)', () => {
    expect(tabs).toContain('<StoryRail bare rows={2}');
    const rail = src('components/story/StoryRail.tsx');
    expect(rail).toMatch(/rows === 2 \? `grid \$\{TWO_ROW_COLS\} grid-flow-col grid-rows-2` : 'flex'/);
    // 칸 폭은 화면 폭에 맞춰 2.8칸이 보이게 — 셋째 칸이 늘 조금 잘려 보여야 옆으로 더 있다는 걸 안다
    expect(rail).toMatch(/TWO_ROW_COLS = 'auto-cols-\[clamp\(118px,calc\(\(100vw_-_24px\)\/2\.8_-_10px\),140px\)\]'/);
    expect(rail).toMatch(/rows = 1/); // 기본은 한 줄 — PC 홈은 그대로
    expect(home).toMatch(/<StoryRail \/>/);
  });
  it('★ 비었는지는 칸이 그리기 전에 알린다(useLayoutEffect) — 뒤로 와서 되살린 탭이 한 프레임 다른 칸을 보이지 않게', () => {
    for (const p of ['components/home/ArtWorks.tsx', 'components/home/ClosingSoonExhibitions.tsx', 'components/story/StoryRail.tsx']) {
      expect(src(p), p).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(.+\) onEmpty\?\.\(/);
    }
  });
  it('탭 안의 칸 머리는 제목 없이 오른쪽 단추만 — 링크 이름은 [전체 보기] 하나', () => {
    expect(src('components/home/HomeTabHead.tsx')).toMatch(/>전체 보기<\/Link>/);
    expect(src('components/home/PopularPosts.tsx')).toMatch(/<HomeTabAll to="\/community" \/>/);
    expect(src('components/home/ClosingSoonExhibitions.tsx')).toMatch(/<HomeTabAll to="\/exhibitions" \/>/);
  });
});
