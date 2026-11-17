import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageTabBar from '@/components/shared/PageTabBar';
import StoryRail from '@/components/story/StoryRail';
import ArtWorks from './ArtWorks';
import PopularPosts from './PopularPosts';
import ClosingSoonExhibitions from './ClosingSoonExhibitions';
import { homeTabFromState, resolveHomeTab, visibleHomeTabs, type HomeTabEmpty, type HomeTabId } from '@/lib/homeTabs';

/**
 * 휴대폰·앱 홈 — 배너 아래 칸들을 탭 한 줄로 (2026-11-14 사용자 결정, `lib/homeTabs.ts`). PC 홈은 `HomePage` 가 칸을 그대로 늘어놓는다.
 * 탭은 ArtWorks · ArtStory · 인기글 · 마감임박 공모 — 진행중인 전시·주목할 갤러리는 '일단' 뺐다(PC 에만).
 *
 * - ⚠️ 칸은 **모두 한 번만 띄워 두고** 고른 칸만 보인다(나머지는 `hidden`). 탭을 오갈 때마다 다시 띄우면 ArtWorks 가 새 시드로
 *   다른 작품을 받아 오고(되돌아왔는데 작품이 바뀐다) 소식 줄이 보던 자리를 잃는다. 숨긴 칸의 사진은 lazy 라 보일 때 받는다.
 * - ⚠️ 칸이 비었는지는 **칸이 알려 준다**(`onEmpty`) — 여기서 데이터를 또 불러 판정하면 '비었다'의 규칙이 두 곳이 된다.
 * - 고른 탭은 이 기록의 state(`homeTab`)에 replace 로 둔다 — 다른 화면에 갔다가 뒤로 오면 보던 탭이 열린다.
 * - 탭 줄은 상단바 바로 아래 붙는다(PageTabBar sticky). 내린 채로 탭을 바꾸면 새 칸은 맨 위부터 보인다(줄이 붙는 자리로 되돌린다).
 * - 칸 높이는 최소 '탭 줄 아래 보이는 높이' — 짧은 칸으로 바꿔도 화면이 위로 끌려 올라가거나 회사 정보가 올라오지 않는다.
 *   (100svh − 상단바 64 − 탭 줄 45 − 하단 탭바 3.5rem+1px − 홈 인디케이터)
 */
export default function HomeTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const [empty, setEmpty] = useState<HomeTabEmpty>({});
  // 칸마다 한 번 만들어 둔다 — 칸의 알리는 효과가 매번 다시 돌지 않게
  const report = useMemo(() => {
    const make = (id: HomeTabId) => (e: boolean) => setEmpty((p) => (p[id] === e ? p : { ...p, [id]: e }));
    return { works: make('works'), story: make('story'), closing: make('closing') };
  }, []);
  const tabs = visibleHomeTabs(empty);
  const active = resolveHomeTab(homeTabFromState(location.state), tabs);
  const marker = useRef<HTMLDivElement>(null);
  const picked = useRef(false);

  const select = (id: HomeTabId) => {
    if (id === active) return;
    picked.current = true;
    const prev = location.state && typeof location.state === 'object' ? location.state : {};
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: { ...prev, homeTab: id } },
    );
  };

  useLayoutEffect(() => {
    // 고른 탭이 줄 밖으로 걸쳐 있으면(오른쪽 끝 탭 등) 줄을 밀어 다 보이게 — 가로로만 움직인다
    const tab = document.getElementById(`home-tab-${active}`);
    const list = tab?.parentElement;
    if (tab && list) {
      const t = tab.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      if (t.left < l.left) list.scrollLeft -= l.left - t.left;
      else if (t.right > l.right) list.scrollLeft += t.right - l.right;
    }
    // 탭 줄이 상단바 아래 붙어 있을 때(내려 둔 상태) 탭을 바꾸면 줄이 붙는 자리로 — 새 칸을 중간부터 보여 주지 않는다.
    // ⚠️ 칸을 바꾼 **뒤에**(그리기 전) 놓는다. 바꾸기 전에 놓으면 크롬의 스크롤 고정(scroll anchoring)이 칸이 바뀌는 순간
    //    5~6px 을 다시 옮겨 새 칸 윗부분이 탭 줄 밑에 깔렸다(사파리는 그 기능이 없어 멀쩡했다).
    if (!picked.current) return;
    picked.current = false;
    const m = marker.current;
    const bar = m?.nextElementSibling;
    if (m && bar instanceof HTMLElement) {
      const stick = parseFloat(getComputedStyle(bar).top) || 0;
      const top = Math.round(m.getBoundingClientRect().top + window.scrollY - stick);
      if (window.scrollY > top) window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [active, tabs.length]);

  const panel = (id: HomeTabId, node: ReactNode) => (
    <div role="tabpanel" id={`home-panel-${id}`} aria-labelledby={`home-tab-${id}`} hidden={id !== active} data-testid={`home-panel-${id}`}>
      {node}
    </div>
  );

  return (
    <div data-testid="home-tabs" className="px-6">
      <div ref={marker} aria-hidden="true" />
      <PageTabBar tabs={tabs} active={active} onSelect={select} idPrefix="home" label="홈" />
      <div className="min-h-[calc(100svh_-_109px_-_3.5rem_-_1px_-_env(safe-area-inset-bottom))] pb-12 pt-1">
        {panel('works', <ArtWorks bare onEmpty={report.works} />)}
        {/* 소식은 두 줄 — 한 줄이면 칸 아래가 허했다(2026-11-14 사용자 지적) */}
        {panel('story', <StoryRail bare rows={2} onEmpty={report.story} />)}
        {panel('popular', <PopularPosts bare />)}
        {panel('closing', <ClosingSoonExhibitions bare onEmpty={report.closing} />)}
      </div>
    </div>
  );
}
