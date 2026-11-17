/**
 * ArtStory (`/feed`, 2026-11-14 개편, CLAUDE.md 규칙 81) — 홈 카드 줄의 [전체 보기].
 *
 * 탭 [전체 · 이웃 · 내 소식]. **전체는 비회원도 본다**(전체공개 소식 — 블라인드 스토리 방식).
 * 세로 카드 격자를 내리면 더 받고, 누르면 홈과 같은 보기 화면(StoryViewer)이 열려 저절로 넘어간다.
 *  · 이웃 = 내가 이웃 추가한 사람들(이웃 공개 소식도 보인다)
 *  · 내 소식 = 내 소식(내린 것·이웃 공개 표시) + 하이라이트 + 소식을 그만 본 사람
 * 알림·공유 링크 `/feed?story=<id>[&comment=<id>]` 는 그 소식부터 보기 화면을 연다(댓글이면 댓글 창을 연 채로).
 * ⚠️ 옛 '피드 카드 목록 + 위쪽 글쓰기 칸'은 없앴다 — 올리기는 머리 오른쪽 [+](곧바로 `/story/new`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { apiErrorMessage } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import PageTabBar from '@/components/shared/PageTabBar';
import HighlightRail from '@/components/shared/HighlightRail';
import HighlightViewer from '@/components/shared/HighlightViewer';
import StoryCard from '@/components/story/StoryCard';
import StoryViewer from '@/components/story/StoryViewer';
import { useStoryCompose } from '@/components/story/useStoryCompose';
import type { StoryHighlight } from '@/types';
import { newStorySeed, readSeenStories, type Story, type StoryAuthor, type StoryPage } from '@/lib/story';

type Tab = 'all' | 'neighbors' | 'mine';

/**
 * [전체] 탭의 무작위 순서 (2026-11-14 사용자 결정 — "새로고침하면 안 본 스토리 랜덤 · 본 건 후순위 · 너무 오래된 건 안 뜨게").
 * 시드와 '이 기기에서 본 소식'을 **열 때 한 번** 찍는다 — 서버가 하루 안 된 내 소식 → 안 본 소식(섞음) → 본 소식(최신순) 으로 놓는다.
 *  - 보는 동안엔 순서가 그대로다(본 소식은 다음 [새로고침]·새로 들어올 때 뒤로 간다).
 *  - 기록(location.key)마다 기억해 두어 **뒤로 오면 같은 순서**(보던 자리를 잃지 않게). 새로 들어오거나 페이지를 새로 불러오면 새 순서.
 */
interface FeedOrder { seed: number; seen: string }
const orderByVisit = new Map<string, FeedOrder>();
const newOrder = (): FeedOrder => ({ seed: newStorySeed(), seen: [...readSeenStories()].join(',') });

function useStoryList(tab: Tab, userId: number | undefined, enabled: boolean, order: FeedOrder) {
  const url = tab === 'all' ? '/stories/public' : tab === 'neighbors' ? '/stories/feed' : `/stories/user/${userId}`;
  return useInfiniteQuery<StoryPage, Error, InfiniteData<StoryPage>, readonly unknown[], number | null>({
    queryKey: tab === 'mine' ? ['stories', 'user', userId] : tab === 'all' ? ['stories', 'public', order.seed] : ['stories', 'neighbors'],
    queryFn: ({ pageParam }) => api.get(url, {
      params: tab === 'all'
        ? { seed: order.seed, ...(order.seen ? { seen: order.seen } : {}), offset: pageParam ?? 0 }
        : { ...(tab === 'neighbors' ? { scope: 'neighbors' } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
    }).then((r) => r.data),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export default function FeedPage() {
  const { isAuthenticated, user } = useAuthStore();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const compose = useStoryCompose();

  const rawTab = params.get('tab');
  const tab: Tab = isAuthenticated && (rawTab === 'neighbors' || rawTab === 'mine') ? rawTab : 'all';
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'all') next.delete('tab'); else next.set('tab', t);
    setParams(next, { replace: true });
  };

  const location = useLocation();
  const [order, setOrder] = useState<FeedOrder>(() => orderByVisit.get(location.key) ?? newOrder());
  useEffect(() => { orderByVisit.set(location.key, order); }, [location.key, order]);

  const list = useStoryList(tab, user?.id, tab === 'all' || isAuthenticated, order);
  // 무작위 순서는 쪽을 offset 으로 잇는다 — 그사이 소식이 새로 올라오면 앞 쪽 끝이 다음 쪽에 한 번 더 올 수 있어 id 로 거른다
  const stories = useMemo(() => {
    const ids = new Set<number>();
    return (list.data?.pages.flatMap((p) => p.stories) ?? []).filter((s) => {
      if (ids.has(s.id)) return false;
      ids.add(s.id);
      return true;
    });
  }, [list.data]);
  const followingCount = list.data?.pages[0]?.followingCount;

  // 내리면 더 받는다
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((es) => { if (es[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── 보기 화면 ──
  const [viewer, setViewer] = useState<{ stories: Story[]; start: number; comments: boolean; focus: number | null; fromLink: boolean } | null>(null);
  const linkId = Number(params.get('story')) || null;
  const linkComment = Number(params.get('comment')) || null;
  const { data: linked, isError: linkGone } = useQuery<Story>({
    queryKey: ['story', linkId],
    queryFn: () => api.get(`/stories/${linkId}`).then((r) => r.data),
    enabled: !!linkId,
    retry: false,
  });
  // 알림·공유 링크 — 그 소식부터 열고, 끝나면 지금 탭의 소식으로 이어 본다
  const openedLink = useRef<number | null>(null);
  useEffect(() => {
    if (!linkId || !linked || openedLink.current === linkId) return;
    const t = window.setTimeout(() => {
      openedLink.current = linkId;
      setViewer({ stories: [linked, ...stories.filter((s) => s.id !== linked.id)], start: 0, comments: !!linkComment, focus: linkComment, fromLink: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [linkId, linked, linkComment, stories]);
  const dropLink = () => {
    const next = new URLSearchParams(params);
    next.delete('story'); next.delete('comment');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (!linkGone || !linkId) return;
    toast.error('지워졌거나 볼 수 없는 소식이에요.', { id: 'story-gone' });
    const t = window.setTimeout(dropLink, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkGone, linkId]);

  const grid = useRef<HTMLDivElement>(null);
  const closeViewer = (last: number, changed: boolean) => {
    const v = viewer;
    setViewer(null);
    if (v?.fromLink) dropLink();
    if (changed) qc.invalidateQueries({ queryKey: ['stories'] });
    if (!v || v.fromLink) return;
    const id = v.stories[last]?.id;
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-story-card="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  // ── 내 소식 탭: 하이라이트 · 그만 본 사람 ──
  const { data: myHighlights } = useQuery<StoryHighlight[]>({
    queryKey: ['highlights', user?.id],
    queryFn: () => api.get(`/stories/highlights/${user!.id}`).then((r) => r.data),
    enabled: tab === 'mine' && !!user?.id,
  });
  const [openHighlight, setOpenHighlight] = useState<number | null>(null);
  const [newHighlight, setNewHighlight] = useState<{ name: string; isPublic: boolean } | null>(null);
  const createHighlight = useMutation({
    mutationFn: (d: { name: string; isPublic: boolean }) => api.post('/stories/highlights', d).then((r) => r.data),
    onSuccess: () => { setNewHighlight(null); qc.invalidateQueries({ queryKey: ['highlights'] }); toast.success('하이라이트를 만들었어요.'); },
    onError: (e) => toast.error(apiErrorMessage(e, '만들지 못했어요.')),
  });
  const { data: mutes } = useQuery<StoryAuthor[]>({
    queryKey: ['story-mutes'],
    queryFn: () => api.get('/stories/mutes').then((r) => r.data),
    enabled: tab === 'mine' && isAuthenticated,
  });
  const unmute = useMutation({
    mutationFn: (id: number) => api.delete(`/stories/mutes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['story-mutes'] }); qc.invalidateQueries({ queryKey: ['stories'] }); },
  });

  const [refreshing, setRefreshing] = useState(false);
  /**
   * [전체] 는 새 시드 + 지금까지 본 소식으로 순서를 다시 정한다(안 본 소식은 다시 섞이고 본 소식은 뒤로).
   * 다른 탭은 ⚠️ invalidate 가 아니라 reset — 펼쳐 둔 쪽을 전부 다시 받지 않고 1쪽부터 다시 시작한다(새 소식은 맨 위).
   */
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (tab === 'all') setOrder(newOrder());
      else await qc.resetQueries({ queryKey: ['stories'] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setRefreshing(false); }
  };

  const tabs = isAuthenticated
    ? [{ id: 'all' as Tab, label: '전체' }, { id: 'neighbors' as Tab, label: '이웃' }, { id: 'mine' as Tab, label: '내 소식' }]
    : [{ id: 'all' as Tab, label: '전체' }];

  const empty = !list.isLoading && stories.length === 0;

  return (
    <div className="py-8 md:py-12">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="font-serif text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            Art<span className="text-accent">Story</span>
          </h1>
          <button type="button" onClick={compose.start} aria-label="소식 올리기" title="소식 올리기"
            className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-gray-700 hover:bg-gray-100 hover:text-gray-900">
            <Plus size={22} strokeWidth={2.2} />
          </button>
        </div>

        <div className="relative">
          <PageTabBar tabs={tabs} active={tab} onSelect={setTab} idPrefix="artstory" label="소식 범위" />
          <button type="button" onClick={refresh} disabled={refreshing}
            className="absolute right-0 top-0 z-30 hidden h-11 items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 sm:inline-flex lg:top-0">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>

        <div id={`artstory-panel-${tab}`} role="tabpanel" aria-labelledby={`artstory-tab-${tab}`} className="pt-5">
          {tab === 'mine' && (
            <div className="mb-6 border-b border-gray-100 pb-6">
              <HighlightRail highlights={myHighlights ?? []} onCreate={() => setNewHighlight({ name: '', isPublic: true })} onOpen={(h) => setOpenHighlight(h.id)} />
            </div>
          )}

          {list.isLoading ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[3/5] animate-pulse rounded-md bg-gray-100" />)}
            </div>
          ) : empty ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-6 py-14 text-center">
              {tab === 'neighbors' ? (
                <>
                  <p className="text-sm text-gray-600">{followingCount === 0 ? '이웃 추가한 사람이 없어요.' : '이웃이 올린 소식이 없어요.'}</p>
                  <Link to="/artists" className="mt-3 inline-block text-sm font-bold text-gray-900 underline underline-offset-4">작가 둘러보기</Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">{tab === 'mine' ? '아직 올린 소식이 없어요.' : '아직 올라온 소식이 없어요.'}</p>
                  <button type="button" onClick={compose.start} className="mt-3 inline-flex h-10 items-center gap-1 rounded-lg bg-gray-900 px-4 text-sm font-bold text-white">
                    <Plus size={15} strokeWidth={2.6} /> 소식 올리기
                  </button>
                </>
              )}
            </div>
          ) : (
            <div ref={grid} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-5">
              {stories.map((s, i) => (
                <StoryCard
                  key={s.id}
                  story={s}
                  className="aspect-[3/5] w-full"
                  onOpen={() => setViewer({ stories, start: i, comments: false, focus: null, fromLink: false })}
                  badge={tab === 'mine' && (s.hidden || s.visibility === 'NEIGHBORS') ? (
                    <>
                      {s.hidden && <span className="rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-white">내려간 소식</span>}
                      {s.visibility === 'NEIGHBORS' && <span className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">이웃 공개</span>}
                    </>
                  ) : undefined}
                />
              ))}
            </div>
          )}
          <div ref={sentinel} aria-hidden="true" className="h-px" />
          {list.isFetchingNextPage && <div className="py-6 text-center text-sm text-gray-500">더 불러오는 중…</div>}

          {tab === 'mine' && mutes && mutes.length > 0 && (
            <section className="mt-12 border-t border-gray-100 pt-6" aria-labelledby="story-mutes">
              <h2 id="story-mutes" className="mb-3 text-sm font-bold text-gray-900">소식을 그만 본 사람</h2>
              <ul className="divide-y divide-gray-100">
                {mutes.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    {m.avatar
                      ? <img src={m.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                      : <span className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{m.name.slice(0, 1)}</span>}
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{m.name}</span>
                    <button type="button" onClick={() => unmute.mutate(m.id)} disabled={unmute.isPending}
                      className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 hover:bg-gray-50">다시 보기</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {viewer && (
        <StoryViewer
          stories={viewer.stories}
          startIndex={viewer.start}
          openComments={viewer.comments}
          focusCommentId={viewer.focus}
          onClose={closeViewer}
          onCompose={compose.start}
        />
      )}
      {openHighlight != null && <HighlightViewer highlightId={openHighlight} onClose={() => setOpenHighlight(null)} />}
      {newHighlight && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3" role="dialog" aria-modal="true" aria-label="새 하이라이트"
          onClick={() => setNewHighlight(null)} onKeyDown={(e) => { if (e.key === 'Escape') setNewHighlight(null); }}>
          <form className="w-96 max-w-full rounded-lg bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); const n = newHighlight.name.trim(); if (n) createHighlight.mutate({ name: n, isPublic: newHighlight.isPublic }); }}>
            <h2 className="mb-4 text-lg font-semibold">새 하이라이트</h2>
            <label htmlFor="highlight-name" className="sr-only">하이라이트 이름</label>
            <input id="highlight-name" autoFocus value={newHighlight.name} maxLength={50} placeholder="하이라이트 이름"
              onChange={(e) => setNewHighlight({ ...newHighlight, name: e.target.value })}
              className="mb-4 h-11 w-full rounded-lg border border-gray-300 px-3 focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <label className="mb-4 flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={newHighlight.isPublic} onChange={(e) => setNewHighlight({ ...newHighlight, isPublic: e.target.checked })} className="h-4 w-4" />
              <span className="text-sm text-gray-700">공개</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNewHighlight(null)} className="h-10 rounded-lg px-4 text-sm text-gray-600 hover:bg-gray-100">취소</button>
              <button type="submit" disabled={!newHighlight.name.trim() || createHighlight.isPending}
                className="h-10 rounded-lg bg-gray-950 px-4 text-sm text-white hover:bg-gray-900 disabled:opacity-50">
                {createHighlight.isPending ? '만드는 중…' : '만들기'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
