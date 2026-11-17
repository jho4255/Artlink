/**
 * ArtStory 홈 공개 (2026-11-14, CLAUDE.md 규칙 81) — 화면 규칙과 소스 가드.
 * 넘김 시간·순서·손동작·쓰던 소식은 순수 함수라 여기서 돌린다. 보기 화면의 실제 동작은 e2e 80 이 본다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STORY_BG_KEYS, STORY_BGS, STORY_REPORT_REASONS, STORY_DAILY_MAX, STORY_RAIL_MAX,
  slideDuration, storyBgHex, orderRail, nextPosition, prevPosition, readGesture, markStorySeen, readSeenStories, storyPath, textStorySize,
} from '@/lib/story';
import { readStoryDraft, saveStoryDraft, clearStoryDraft } from '@/lib/storyDraft';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');
const server = readFileSync(resolve(__dirname, '../../../backend/src/lib/storyRules.ts'), 'utf-8');
const serverList = (name: string) => {
  const m = server.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean) : null;
};
const serverNum = (name: string) => Number(server.match(new RegExp(`export const ${name} = (\\d+)`))?.[1]);

describe('서버 규칙과 같은 값(거울)', () => {
  it('바탕색 이름 · 신고 사유 · 하루 상한 · 줄 상한', () => {
    expect([...STORY_BG_KEYS]).toEqual(serverList('STORY_BG_KEYS'));
    expect([...STORY_REPORT_REASONS]).toEqual(serverList('STORY_REPORT_REASONS'));
    expect(STORY_DAILY_MAX).toBe(serverNum('STORY_DAILY_MAX'));
    expect(STORY_RAIL_MAX).toBe(serverNum('STORY_RAIL_MAX'));
    expect(Object.keys(STORY_BGS)).toEqual([...STORY_BG_KEYS]);
  });

  it('글만 소식 바탕색 — 흰 글자가 4.5:1 넘게 읽히는 짙은 색만, 모르는 값은 첫 색', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    for (const { hex } of Object.values(STORY_BGS)) expect(1.05 / (lum(hex) + 0.05)).toBeGreaterThan(4.5);
    expect(storyBgHex(null)).toBe(STORY_BGS.slate.hex);
    expect(storyBgHex('#ff0000')).toBe(STORY_BGS.slate.hex);
    expect(storyBgHex('forest')).toBe(STORY_BGS.forest.hex);
  });
});

describe('넘김 시간', () => {
  it('사진 5초 · 글만 6.5초가 기본, 글이 길면 더 준다(상한 있음) · 사진 소식의 글은 첫 장에서만', () => {
    expect(slideDuration({ images: ['a'], caption: '짧은 글' }, 0)).toBe(5000);
    expect(slideDuration({ images: [], caption: '짧은 글' }, 0)).toBe(6500);
    const long = '가'.repeat(600);
    expect(slideDuration({ images: [], caption: long }, 0)).toBe(15000);
    expect(slideDuration({ images: ['a', 'b'], caption: long }, 0)).toBe(10000);
    expect(slideDuration({ images: ['a', 'b'], caption: long }, 1)).toBe(5000);
    expect(slideDuration({ images: [], caption: '가'.repeat(120) }, 0)).toBeGreaterThan(6500);
  });

  it('글만 소식 글자 크기 — 짧으면 크게', () => {
    expect(textStorySize('오늘 오픈 스튜디오')).toBe('lg');
    expect(textStorySize('가'.repeat(100))).toBe('md');
    expect(textStorySize('가'.repeat(400))).toBe('sm');
  });
});

describe('홈 줄 순서 · 본 소식', () => {
  beforeEach(() => localStorage.clear());

  it('★ 이 기기에서 본 소식은 뒤로, 내 소식은 늘 앞쪽(본 것으로 치지 않는다), 순서는 지킨다', () => {
    const s = (id: number, mine = false) => ({ id, mine });
    const out = orderRail([s(1), s(2, true), s(3), s(4), s(5)], new Set([1, 2, 4]));
    expect(out.map((x) => x.id)).toEqual([2, 3, 5, 1, 4]);
  });

  it('본 소식 기억 — 겹치지 않고, 오래된 것부터 잘린다', () => {
    markStorySeen(3); markStorySeen(4); markStorySeen(3);
    expect([...readSeenStories()]).toEqual([4, 3]);
    for (let i = 0; i < 500; i++) markStorySeen(1000 + i);
    const seen = readSeenStories();
    expect(seen.size).toBe(400);
    expect(seen.has(1499)).toBe(true);
    expect(seen.has(3)).toBe(false);
  });

  it('저장소가 망가져 있어도 던지지 않는다', () => {
    localStorage.setItem('artlink-stories-seen', '{not json');
    expect(readSeenStories().size).toBe(0);
  });
});

describe('넘기는 자리 · 손동작', () => {
  it('칸 → 다음 칸 → 다음 소식 첫 칸 → 끝', () => {
    const slides = [2, 1, 3];
    expect(nextPosition(slides, 0, 0)).toEqual({ i: 0, slide: 1 });
    expect(nextPosition(slides, 0, 1)).toEqual({ i: 1, slide: 0 });
    expect(nextPosition(slides, 2, 2)).toBeNull();
    expect(prevPosition(1, 0)).toEqual({ i: 0, slide: 0 });
    expect(prevPosition(2, 2)).toEqual({ i: 2, slide: 1 });
    expect(prevPosition(0, 0)).toEqual({ i: 0, slide: 0 });
  });

  it('★ 옆으로 밀면 다음/앞 소식, 아래로 밀면 닫기, 짧게 누르면 왼쪽 1/3 은 앞 · 오래 눌렀다 떼면 아무것도', () => {
    const w = 390;
    expect(readGesture({ dx: -120, dy: 10, ms: 200, x: 200, width: w })).toBe('nextStory');
    expect(readGesture({ dx: 120, dy: -8, ms: 200, x: 200, width: w })).toBe('prevStory');
    expect(readGesture({ dx: 10, dy: 160, ms: 300, x: 200, width: w })).toBe('close');
    expect(readGesture({ dx: 2, dy: 1, ms: 120, x: 60, width: w })).toBe('prev');
    expect(readGesture({ dx: 2, dy: 1, ms: 120, x: 300, width: w })).toBe('next');
    expect(readGesture({ dx: 2, dy: 1, ms: 900, x: 300, width: w })).toBe('none');   // 누르고 있기 = 멈춰 보기
    expect(readGesture({ dx: 30, dy: -40, ms: 200, x: 300, width: w })).toBe('none');  // 위로 조금 — 아무것도
  });

  it('소식 주소 = 알림·공유 링크', () => {
    expect(storyPath(7)).toBe('/feed?story=7');
    expect(storyPath(7, 9)).toBe('/feed?story=7&comment=9');
  });
});

describe('쓰던 소식 (이 기기)', () => {
  beforeEach(() => localStorage.clear());

  it('계정마다 따로 · 7일이 지나면 버린다 · 이상한 주소는 거른다', () => {
    saveStoryDraft(1, { mode: 'photo', urls: ['/uploads/a.jpg', 'javascript:alert(1)' as string, '//evil/x'], text: '쓰던 글', bg: 'forest', visibility: 'NEIGHBORS' }, 1_000);
    const d = readStoryDraft(1, 2_000)!;
    expect(d).toMatchObject({ mode: 'photo', urls: ['/uploads/a.jpg'], text: '쓰던 글', bg: 'forest', visibility: 'NEIGHBORS' });
    expect(readStoryDraft(2, 2_000)).toBeNull();
    expect(readStoryDraft(1, 1_000 + 8 * 24 * 3600 * 1000)).toBeNull();
    clearStoryDraft(1);
    expect(readStoryDraft(1, 2_000)).toBeNull();
  });

  it('사진이 없으면 글만 소식으로, 모르는 색은 첫 색', () => {
    saveStoryDraft(1, { mode: 'photo', urls: [], text: '글만', bg: 'nope' as never, visibility: 'PUBLIC' }, 1_000);
    expect(readStoryDraft(1, 2_000)).toMatchObject({ mode: 'text', bg: 'slate' });
  });
});

describe('소스 가드', () => {
  it('★ 사진은 자르지 않는다 — 카드·보기 화면·올리기 화면이 같은 부품(StoryPhoto, contain)을 쓴다 (흐린 배경만 cover)', () => {
    const photo = src('components/story/StoryPhoto.tsx');
    expect(photo).toMatch(/h-full w-full object-contain/);
    expect(photo).not.toMatch(/object-cover/);
    const card = src('components/story/StoryCard.tsx');
    const viewer = src('components/story/StoryViewer.tsx');
    const compose = src('pages/StoryComposePage.tsx');
    // 사진 위 글이 세 화면에서 같은 자리·같은 비율로 보이려면 같은 부품이어야 한다
    expect(card).toMatch(/<StoryPhoto src=\{img\} size="grid"/);
    expect(viewer).toMatch(/<StoryPhoto\b/);
    expect(compose).toMatch(/<StoryPhoto\b/);
    // cover 는 흐린 배경과 동그란 얼굴 사진에만(작품이 아니다)
    for (const f of [card, viewer, compose]) {
      for (const m of f.matchAll(/className="[^"]*object-cover[^"]*"/g)) expect(m[0], '흐린 배경·얼굴 사진에만 cover').toMatch(/blur|rounded-full/);
    }
  });

  it('★ [+] 는 곧바로 올리기 화면 — 사진/글을 먼저 고르는 창은 없다(2026-11-14 사용자 결정)', () => {
    const hook = src('components/story/useStoryCompose.tsx');
    expect(hook).toMatch(/navigate\('\/story\/new'/);
    expect(hook).not.toMatch(/role="dialog"/);
    for (const f of ['components/story/useStoryCompose.tsx', 'pages/StoryComposePage.tsx', 'components/story/StoryRail.tsx', 'pages/FeedPage.tsx']) {
      const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toContain('사진 고르기');
      expect(code, f).not.toContain('글만 쓰기');
    }
    // 한 페이지에서 — 글(색 바탕) · [사진] · 사진 위 글([Aa])
    const compose = src('pages/StoryComposePage.tsx');
    expect(compose).toMatch(/aria-label="사진 위에 글 쓰기"/);
    expect(compose).toMatch(/aria-label="사진 위 글"/);
    expect(compose).toMatch(/<ImagePlus size=\{17\} \/> 사진/);
  });

  it('★ 머리의 올리기는 테두리 없는 [+] 아이콘 — 홈의 다른 칸 머리와 같은 결(2026-11-14 사용자 지적)', () => {
    for (const f of ['components/story/StoryRail.tsx', 'pages/FeedPage.tsx']) {
      const code = src(f);
      expect(code, f).toMatch(/aria-label="소식 올리기" title="소식 올리기"/);
      expect(code, f).not.toMatch(/border border-gray-900 px-3 text-sm font-bold text-gray-900 hover:bg-gray-50">\s*<Plus/);
    }
  });

  it('★ 보기 화면은 dialog — 소개·홈페이지 팝업이 기다리고 앱 뒤로가기가 Esc 를 보낸다 · 하단 탭바(z-40) 위', () => {
    const viewer = src('components/story/StoryViewer.tsx');
    expect(viewer).toMatch(/role="dialog"\s+aria-modal="true"/);
    expect(viewer).toMatch(/z-50/);
    // 진행은 CSS 애니메이션 하나 — 매 프레임 다시 그리지 않는다
    expect(viewer).toMatch(/animation: `storyFill \$\{dur\}ms linear forwards`/);
    expect(viewer).toMatch(/animationPlayState: running \? 'running' : 'paused'/);
    expect(src('index.css')).toMatch(/@keyframes storyFill/);
  });

  it('★ 설명 문구를 두지 않는다 — 화면은 스스로 설명하지 않는다(2026-11-14 사용자 지적)', () => {
    for (const f of ['components/story/StoryRail.tsx', 'pages/FeedPage.tsx', 'pages/StoryComposePage.tsx', 'components/story/useStoryCompose.tsx', 'components/story/StoryViewer.tsx']) {
      const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const ban of ['누구나 올리고', '모두가 봐요', '자르지 않아요', '홈에 보여요', '한 장 올려 보세요', '방향키로']) {
        expect(code, `${f}: ${ban}`).not.toContain(ban);
      }
    }
  });

  it('★ 홈 아래 칸은 한 격자에 흘려 넣는다 — 빈 칸(null)이 반쪽 자리를 남기지 않게(2026-11-14 사용자 지적)', () => {
    const home = src('pages/HomePage.tsx');
    const block = home.slice(home.indexOf('data-testid="home-widgets"'));
    expect(block).toMatch(/md:grid-cols-2/);
    expect(block).toMatch(/\[&>\*\]:min-w-0/);
    expect(block).toMatch(/md:\[&>\*:last-child:nth-child\(odd\)\]:col-span-2/);
    // 인기글 바로 옆이 마감임박 공모 — 칸을 div 로 감싸지 않는다(감싸면 null 이어도 자리를 먹는다)
    const order = ['<PopularPosts />', '<ClosingSoonExhibitions />', '<OngoingShows />', '<GalleryOfMonthSection variant="rail" />'].map((t) => block.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(block.slice(0, block.indexOf('</section>'))).not.toMatch(/<div className="min-w-0">/);
  });

  it('홈 — 배너 다음, ArtWorks 앞에 ArtStory 줄', () => {
    const home = src('pages/HomePage.tsx');
    const hero = home.indexOf('<HeroSlider />');
    const rail = home.indexOf('<StoryRail />');
    const works = home.indexOf('<ArtWorks />');
    expect(hero).toBeGreaterThan(-1);
    expect(rail).toBeGreaterThan(hero);
    expect(works).toBeGreaterThan(rail);
  });

  it('라우터 — /feed 는 비회원도 열리고, 올리기 화면은 Layout 밖', () => {
    const app = src('App.tsx');
    expect(app).toMatch(/<Route path="\/feed" element=\{<FeedPage \/>\} \/>/);
    const layoutEnd = app.indexOf('</Route>\n      {/* 커뮤니티 글쓰기');
    const compose = app.indexOf('path="/story/new"');
    expect(layoutEnd).toBeGreaterThan(-1);
    expect(compose).toBeGreaterThan(layoutEnd);
  });

  it('PC 홈 줄은 스크롤바 없이 화살표로 넘긴다', () => {
    const rail = src('components/story/StoryRail.tsx');
    expect(rail).toMatch(/className=\{?[`"]story-rail /); // 휴대폰 홈 탭의 두 줄(rows={2}) 때문에 템플릿 문자열이 됐다
    expect(rail).toMatch(/aria-label="다음 소식 보기"/);
    expect(src('index.css')).toMatch(/\.story-rail::-webkit-scrollbar \{ display: none; \}/);
  });
});

describe('[전체 보기] 무작위 순서 · 마우스 화살표 (2026-11-14 사용자 결정)', () => {
  const feed = src('pages/FeedPage.tsx');
  it('★ [전체] 는 시드·본 소식·offset 으로 받는다 — 시드가 쿼리 키에 있다', () => {
    expect(feed).toMatch(/tab === 'all' \? \['stories', 'public', order\.seed\]/);
    expect(feed).toMatch(/\{ seed: order\.seed, \.\.\.\(order\.seen \? \{ seen: order\.seen \} : \{\}\), offset: pageParam \?\? 0 \}/);
  });
  it('★ 열 때 한 번 찍고, 기록(location.key)마다 기억 — 뒤로 오면 같은 순서, [새로고침]이면 새 순서(본 소식은 뒤로)', () => {
    expect(feed).toMatch(/useState<FeedOrder>\(\(\) => orderByVisit\.get\(location\.key\) \?\? newOrder\(\)\)/);
    expect(feed).toMatch(/seen: \[\.\.\.readSeenStories\(\)\]\.join\(','\)/);
    expect(feed).toMatch(/if \(tab === 'all'\) setOrder\(newOrder\(\)\)/);
  });
  it('본 소식 기억 수는 서버가 받는 상한과 같다', () => {
    expect(server).toMatch(/export const STORY_SEEN_MAX = 400;/);
    expect(src('lib/story.ts')).toMatch(/export const STORY_SEEN_MAX = 400;/);
  });
  it('★ 휴대폰 두 줄도 마우스로 볼 땐 화살표가 나온다(좁은 PC 창에서 옆으로 넘길 방법이 없었다)', () => {
    const rail = src('components/story/StoryRail.tsx');
    expect(rail).toMatch(/const arrowShow = rows === 2 \? 'pointer-fine:grid' : 'md:grid'/);
    expect(rail.match(/\$\{arrowShow\}/g)?.length).toBe(2);
  });
});
