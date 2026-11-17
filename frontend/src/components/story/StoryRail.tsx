/**
 * 홈의 ArtStory 카드 줄 (2026-11-14, CLAUDE.md 규칙 81) — 배너 아래, ArtWorks 위.
 *
 * - 이웃이 아니어도 **모두의 전체공개 소식**(블라인드 스토리 방식). 한 사람당 가장 새 소식 하나, 최대 12장.
 * - 이 기기에서 본 소식은 뒤로(화면을 열 때 한 번 찍어 둔 순서 — 보는 동안 자리가 바뀌지 않게).
 * - 휴대폰: 손가락으로 민다(두 장 반이 보여 더 있다는 걸 안다). PC: 스크롤바 없이 **양옆 화살표로 네 장씩**.
 *   아래 스크롤바는 '여기가 끝'처럼 보였다(2026-11-14 사용자 지적).
 * - 누르면 화면 가득 열리고 저절로 넘어간다(StoryViewer). 닫으면 마지막에 본 카드가 보이게 줄을 옮긴다.
 * - 머리 오른쪽 [전체 보기] · [+](테두리 없는 아이콘 — 2026-11-14 사용자 지적: 테두리 '올리기' 단추는 홈의 다른 칸과 결이 안 맞았다).
 *   [+] 는 곧바로 올리기 화면(`/story/new`)으로 간다.
 * - 소식이 4장보다 적으면 맨 앞에 [소식 올리기] 칸. 설명 문구는 두지 않는다(화면은 스스로 설명하지 않는다).
 * ⚠️ 실패하면 이 줄만 조용히 빠진다 — 홈 전체를 흔들지 않는다.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { orderRail, readSeenStories, STORY_UPLOAD_TILE_BELOW, type Story } from '@/lib/story';
import StoryCard from './StoryCard';
import { HomeTabHead } from '@/components/home/HomeTabHead';
// 보기 화면은 누를 때 받는다 — 홈은 첫 화면이라 가볍게(댓글·멘션·메뉴까지 실린 큰 부품이다). 줄이 그려지고 잠시 뒤 미리 받아 둔다.
const loadViewer = () => import('./StoryViewer');
const StoryViewer = lazy(loadViewer);
import { useStoryCompose } from './useStoryCompose';

const CARD = 'h-[246px] w-[148px] md:h-[306px] md:w-[184px]';
/**
 * 휴대폰 홈 탭의 두 줄(`rows={2}`) — 칸 폭은 **화면 폭에 맞춰 2.8칸이 보이게**(118~140px, `TWO_ROW_COLS`),
 * 셋째 칸이 늘 조금 잘려 보여 옆으로 더 있다는 걸 알린다. 고정 폭(124px)이면 412px 앱 화면에서 셋째 칸이 5px 만 잘려 '여기가 끝'처럼 보였다.
 * 비율은 2:3 — 3:5 그대로면 넓은 폰에서 두 줄이 첫 화면을 넘는다(앱 412×838 에서 50px). 2:3 이면 360~430 폭 모두 두 줄이 첫 화면에 든다.
 * 사진은 contain + 흐린 배경이라 칸 비율이 달라도 잘리지 않는다. PC 는 3:5 한 줄 그대로.
 */
const CARD_TWO_ROWS = 'aspect-[2/3] w-full';
const TWO_ROW_COLS = 'auto-cols-[clamp(118px,calc((100vw_-_24px)/2.8_-_10px),140px)]';

/**
 * @param bare 휴대폰 홈 탭 안(2026-11-14, `lib/homeTabs.ts`) — 제목은 탭이 대신하므로 [전체 보기]·[+]만 남긴다
 * @param rows 2 면 카드 두 줄(휴대폰 홈 탭 — 한 줄이면 칸 아래가 허했다, 2026-11-14 사용자 지적).
 *   순서는 위→아래→다음 칸(새 소식이 첫 화면 왼쪽에 모인다), 두 줄이 함께 옆으로 밀린다. 보기 화면 순서도 그대로다.
 * @param onEmpty 답이 오면 알린다 — 소식이 0개여도 [소식 올리기] 칸이 있어 비지 않는다. 비는 건 실패해서 줄이 빠질 때뿐
 */
export default function StoryRail({ bare = false, rows = 1, onEmpty }: { bare?: boolean; rows?: 1 | 2; onEmpty?: (empty: boolean) => void } = {}) {
  const card = rows === 2 ? CARD_TWO_ROWS : CARD;
  /* 화살표 — PC 한 줄은 넓은 화면에서, 휴대폰 두 줄은 **마우스로 볼 때**(좁은 PC 창) 나온다. 손가락으로는 밀면 되고,
     마우스는 옆으로 밀 방법이 없었다(2026-11-14 사용자: "웹에서 ArtStory 옆으로 어케 넘김"). */
  const arrowShow = rows === 2 ? 'pointer-fine:grid' : 'md:grid';
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const { data, isLoading, isError } = useQuery<Story[]>({
    queryKey: ['stories', 'rail', user?.id ?? 0],
    queryFn: () => api.get('/stories/public', { params: { rail: 1 } }).then((r) => r.data.stories),
    staleTime: 60_000,
  });
  useLayoutEffect(() => {
    if (!isLoading) onEmpty?.(isError);
  }, [isLoading, isError, onEmpty]);
  // 본 소식은 화면을 열 때 한 번만 읽는다 — 보는 동안 순서가 바뀌면 닫았을 때 카드 자리가 어긋난다
  const [seen] = useState(readSeenStories);
  const stories = useMemo(() => orderRail(data ?? [], seen), [data, seen]);
  const [open, setOpen] = useState<number | null>(null);
  const compose = useStoryCompose();

  // PC 화살표 — 넘길 게 있을 때만 보인다
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const prev = el.scrollLeft > 4;
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    const raf = requestAnimationFrame(measure);
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure); cancelAnimationFrame(raf); };
  }, [measure, stories.length]);
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('[data-story-card]');
    // 한 줄(PC)은 네 장씩, 휴대폰 두 줄은 두 칸씩 — 넘긴 뒤에도 앞 칸이 조금 남아 어디서 넘어왔는지 안다
    const step = card ? (card.offsetWidth + (rows === 2 ? 10 : 12)) * (rows === 2 ? 2 : 4) : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  const onClose = (last: number, changed: boolean) => {
    setOpen(null);
    if (changed) qc.invalidateQueries({ queryKey: ['stories'] });
    // 마지막에 본 카드가 보이게 — 세로로는 움직이지 않는다
    requestAnimationFrame(() => {
      const card = scroller.current?.querySelectorAll<HTMLElement>('[data-story-card]')[last];
      card?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    });
  };

  useEffect(() => {
    if (!data?.length) return;
    const t = window.setTimeout(() => { void loadViewer(); }, 1500);
    return () => window.clearTimeout(t);
  }, [data?.length]);

  if (isError) return null;
  const tile = !isLoading && stories.length < STORY_UPLOAD_TILE_BELOW;

  /* 다른 홈 칸 머리(작품 새로고침·더보기)와 같은 결 — 회색 글자 + 테두리 없는 [+] */
  const actions = (
    <>
      <Link to="/feed" className="px-2 py-2.5 text-sm text-gray-500 hover:text-gray-900">전체 보기</Link>
      <button type="button" onClick={compose.start} aria-label="소식 올리기" title="소식 올리기"
        className="grid h-10 w-10 place-items-center rounded-full text-gray-700 hover:bg-gray-100 hover:text-gray-900">
        <Plus size={22} strokeWidth={2.2} />
      </button>
    </>
  );

  return (
    <section aria-labelledby={bare ? undefined : 'home-artstory'} data-testid="home-artstory">
      {bare ? (
        <HomeTabHead>{actions}</HomeTabHead>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
          <h2 id="home-artstory" className="text-xl font-bold tracking-tight font-serif text-gray-900 md:text-2xl">
            Art<span className="text-accent">Story</span>
          </h2>
          <div className="-mr-2 flex shrink-0 items-center">{actions}</div>
        </div>
      )}

      <div className="relative">
        <div ref={scroller} data-rows={rows}
          className={`story-rail -mx-6 snap-x snap-proximity gap-2.5 overflow-x-auto scroll-px-6 px-6 md:mx-0 md:gap-3 md:px-0 md:scroll-px-0 ${rows === 2 ? `grid ${TWO_ROW_COLS} grid-flow-col grid-rows-2` : 'flex'}`}>
          {tile && (
            <button type="button" onClick={compose.start}
              className={`${card} flex shrink-0 snap-start flex-col items-center justify-center gap-2.5 rounded-md border border-dashed border-gray-400 bg-gray-50 text-gray-900 hover:bg-gray-100`}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-gray-900 text-white"><Plus size={20} /></span>
              <span className="text-sm font-bold">소식 올리기</span>
            </button>
          )}
          {isLoading
            ? Array.from({ length: rows === 2 ? 6 : 5 }, (_, i) => <div key={i} className={`${card} shrink-0 animate-pulse rounded-md bg-gray-100`} />)
            : stories.map((s, i) => (
              <StoryCard key={s.id} story={s} onOpen={() => setOpen(i)} className={`${card} snap-start`} />
            ))}
        </div>
        {edges.prev && (
          <button type="button" onClick={() => page(-1)} aria-label="앞 소식 보기"
            className={`absolute -left-5 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-gray-300 bg-white text-gray-900 shadow-md hover:bg-gray-50 ${arrowShow}`}>
            <ChevronLeft size={20} />
          </button>
        )}
        {edges.next && (
          <button type="button" onClick={() => page(1)} aria-label="다음 소식 보기"
            className={`absolute -right-5 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-gray-300 bg-white text-gray-900 shadow-md hover:bg-gray-50 ${arrowShow}`}>
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      {open != null && stories[open] && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-black" aria-hidden="true"><span className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" /></div>}>
          <StoryViewer stories={stories} startIndex={open} onClose={onClose} onCompose={compose.start} />
        </Suspense>
      )}
    </section>
  );
}
