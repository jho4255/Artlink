import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import api from '@/lib/axios';
import type { Story, StoryPage } from '@/lib/story';
import type { StoryHighlight } from '@/types';
import StoryCard from '@/components/story/StoryCard';
import HighlightRail from '@/components/shared/HighlightRail';
import HighlightViewer from '@/components/shared/HighlightViewer';
import { useStoryCompose } from '@/components/story/useStoryCompose';
import { PrimaryAction } from './Actions';

// 보기 화면은 누를 때 받는다(홈과 같다 — 규칙 81)
const StoryViewer = lazy(() => import('@/components/story/StoryViewer'));

/**
 * 홈페이지 [소식] 탭 (2026-11-14, CLAUDE.md 규칙 82) — 작가·갤러리 홈페이지에 **그 사람이 올린 ArtStory**.
 *
 * 하이라이트 줄(예전엔 작가 이름 위에 따로 떠 있었다 — 이 탭 안으로 옮겼다) + 세로 카드 격자(카드 머리는 이름 대신 **올린 날**).
 * 누르면 ArtStory 와 같은 보기 화면. 목록은 `GET /stories/user/:userId` — [내 소식] 탭과 **같은 쿼리 키**라 캐시를 나눠 쓴다.
 * 보이는 소식의 규칙(이웃 공개·내린 소식)은 서버 `lib/homepageNews.ts` 한 곳.
 *
 * 비어 있으면: 방문자에겐 탭 자체가 없다(서버가 센 storyCount 로 정한다). 갤러리 주인에겐 탭이 있고 여기서 [소식 올리기].
 */
export default function NewsTab({ userId, isOwner }: { userId: number; isOwner: boolean }) {
  const qc = useQueryClient();
  const compose = useStoryCompose();
  const { data: highlights } = useQuery<StoryHighlight[]>({
    queryKey: ['highlights', userId],
    queryFn: () => api.get(`/stories/highlights/${userId}`).then((r) => r.data),
  });
  // 소식을 다 지운 하이라이트는 동그라미만 남는다 — 탭을 셀 때(서버)와 같이 뺀다
  const shownHighlights = useMemo(() => (highlights ?? []).filter((h) => (h.storyCount ?? 1) > 0), [highlights]);

  const list = useInfiniteQuery<StoryPage, Error, InfiniteData<StoryPage>, readonly unknown[], number | null>({
    queryKey: ['stories', 'user', userId],
    queryFn: ({ pageParam }) => api.get(`/stories/user/${userId}`, { params: pageParam ? { cursor: pageParam } : {} }).then((r) => r.data),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const stories = useMemo(() => list.data?.pages.flatMap((p) => p.stories) ?? [], [list.data]);

  // 내리면 더 받는다
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((es) => { if (es[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const [viewer, setViewer] = useState<{ stories: Story[]; start: number } | null>(null);
  const [openHighlight, setOpenHighlight] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const close = (last: number, changed: boolean) => {
    const v = viewer;
    setViewer(null);
    if (changed) void qc.invalidateQueries({ queryKey: ['stories'] });
    const id = v?.stories[last]?.id;
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-story-card="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  return (
    <div className="flex flex-col gap-8" data-testid="homepage-news">
      {shownHighlights.length > 0 && <HighlightRail highlights={shownHighlights} onOpen={(h) => setOpenHighlight(h.id)} />}

      {list.isLoading ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-[3/5] animate-pulse rounded-md bg-[var(--hp-line)]" />)}
        </div>
      ) : stories.length > 0 ? (
        <div ref={grid} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-5">
          {stories.map((s, i) => (
            <StoryCard
              key={s.id}
              story={s}
              head="date"
              className="aspect-[3/5] w-full"
              onOpen={() => setViewer({ stories, start: i })}
              badge={isOwner && (s.hidden || s.visibility === 'NEIGHBORS') ? (
                <>
                  {s.hidden && <span className="rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-white">내려간 소식</span>}
                  {s.visibility === 'NEIGHBORS' && <span className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">이웃 공개</span>}
                </>
              ) : undefined}
            />
          ))}
        </div>
      ) : isOwner ? (
        <div className="py-10 text-center">
          <PrimaryAction onClick={compose.start}><Plus size={15} strokeWidth={2.4} className="mr-1" /> 소식 올리기</PrimaryAction>
        </div>
      ) : null}

      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {list.isFetchingNextPage && <p className="text-center text-sm text-[var(--hp-sub)]">더 불러오는 중…</p>}

      {viewer && (
        <Suspense fallback={null}>
          {/* 끝 화면('새 소식을 다 봤어요' + 소식 올리기)은 주인에게만 — 남의 홈페이지에서 방문자에게 올리기를 권하지 않는다 */}
          <StoryViewer stories={viewer.stories} startIndex={viewer.start} onClose={close} onCompose={compose.start} endScreen={isOwner} />
        </Suspense>
      )}
      {openHighlight != null && <HighlightViewer highlightId={openHighlight} onClose={() => setOpenHighlight(null)} />}
    </div>
  );
}
