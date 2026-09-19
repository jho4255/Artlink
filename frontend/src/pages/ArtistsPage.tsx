/**
 * ArtistsPage — `/artists` · Navbar [작가] 탭 (2026-09-10, 둘러보기 흡수 2026-09-13)
 *
 * 왼쪽에 **작가 색인**, 오른쪽에 **작품 격자**. 작가 이름을 누르면 그 작가의 공개 홈페이지
 * (`/portfolio/:id`)로 간다. 홈의 `ArtWorks` 섹션이 맛보기였다면 **여기가 본판**이다.
 *
 * ## 둘러보기(`/explore`)를 여기로 합쳤다 (2026-09-13 사용자 요청)
 * 예전엔 작품을 보는 화면이 **둘**이었고 **제목이 `ArtWorks` 로 똑같았다** — `/explore` 와 `/artists`.
 * 홈 [모두 모아보기]는 `/explore` 로, [작가] 탭은 `/artists` 로 갔고, `/artists` 안의
 * [모두 모아보기]가 다시 `/explore` 로 보냈다. 같은 이름의 화면이 아무 설명 없이
 * 작가 목록이 사라지고 열 수가 바뀌고 [좋아요순]이 생기니 "왜 다르지?" 가 됐다(사용자 신고).
 *   - 지금은 **작품 화면이 하나뿐**이다. `/explore` 는 여기로 **리다이렉트**한다(404 아님 —
 *     옛 링크·북마크·알림이 죽지 않게, 혜택 페이지와 같은 방식).
 *   - 그래서 이 화면이 둘러보기가 갖고 있던 것을 전부 갖는다: **무한스크롤 · [좋아요순] · 기간 필터**.
 *   - ⚠️ **[모두 모아보기] 버튼은 없앴다** — 여기가 끝이라 갈 곳이 없다. 되살리지 말 것.
 *   - ⚠️ 이름(`ArtWorks`)은 **그대로 둔다**(2026-09-13 사용자 지정). 화면이 하나가 됐으므로 겹치지 않는다.
 *
 * ## 목록에 누가 들어가나
 * **공개 작품이 한 장이라도 있는 작가만** (`GET /explore/artists`). 가입만 한 계정까지 실으면
 * 목록이 회원 명부가 되고, 눌러 들어가면 텅 빈 홈페이지가 나온다.
 *
 * ## 순서는 가나다순 + ㄱ/ㄴ/ㄷ 펼쳐보기 (2026-09-13 사용자 요청으로 랜덤에서 되돌림)
 * 서버가 **칸(초성) 순서 → 이름순**으로 정렬하고 이름마다 `initial` 을 실어 준다. 화면은 그걸
 * 묶어서 전화번호부처럼 접었다 편다(`lib/artistIndex.ts`).
 *   ⚠️ **화면에서 초성을 다시 계산하지 말 것** — 판정은 `backend/src/lib/hangulIndex.ts` 한 곳이다.
 *   ⚠️ 서버가 정렬해 준 순서를 다시 정렬하지 말 것 — 브라우저의 `localeCompare` 가 서버의 그것과
 *      같다는 보장이 없다(순서와 칸이 어긋나면 'ㄱ' 칸 안에 'ㄴ' 이름이 섞인다).
 *   ⚠️ 처음에 펼쳐 둘지는 **작가 수로 가른다**(`AUTO_EXPAND_MAX`). 적은데 접어 두면 이름 하나
 *      보려고 한 번 더 눌러야 하고, 많은데 펼쳐 두면 왼쪽 칸이 수천 px 이 되어 작품 격자가 밀린다.
 * ⚠️ [순서 바꾸기]는 **없앴다**(랜덤이던 시절의 버튼). 작품 격자의 [작품 새로고침]은 그대로다 —
 *    작가 목록과 작품은 여전히 **별개 축**이라, 작가를 훑던 중에 작품이 바뀌면 안 된다.
 * ⚠️ **작품 수는 화면에 안 그린다**(2026-09-10). 응답에는 남아 있다 — 그 값이 0 이면 애초에
 *    목록에 없어야 하므로, 회귀 테스트가 그걸로 필터를 검증한다.
 * ⚠️ **칸마다 몇 명인지도, '가나다순' 이라는 안내도 그리지 않는다**(2026-09-13 요청) —
 *    펼치면 바로 보이는 것이라 적어 두면 잔소리이고, 좁은 왼쪽 칸에서 글자만 늘어난다.
 *
 * ⚠️ 작가 이름을 눌러 **격자를 거르지 않는다** — 사용자가 원한 동작은 '그 작가에게 가는 것'이다.
 *    거르기까지 하면 눌렀을 때 무슨 일이 나는지 두 가지가 되어 예측이 안 된다.
 * ⚠️ 작품 격자는 홈과 **같은 규칙**(랜덤 + 같은 작가 연속 방지, [새로고침]은 시드만 교체)을 쓴다.
 *    두 화면에서 누른 느낌이 달라지면 안 된다.
 *
 * @see backend/src/routes/explore.ts — GET /explore/artists · GET /explore/highlight
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Heart, RefreshCw, ChevronDown } from 'lucide-react';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import { groupByInitial, initiallyExpanded } from '@/lib/artistIndex';
import SkeletonImage from '@/components/shared/SkeletonImage';
import ArtworkDetailModal from '@/components/shared/ArtworkDetailModal';
import { artistPath } from '@/lib/handle';
import type { ExploreImage } from '@/types';

interface ArtistEntry {
  id: number;
  name: string;
  /** 홈페이지 주소 — 있으면 `/@handle` 로 링크한다(2026-09-16) */
  handle?: string | null;
  avatar: string | null;
  /** 서버가 정해 준 색인 칸 (ㄱ~ㅎ · `A–Z` · `#`) — 화면에서 다시 계산하지 않는다 */
  initial: string;
  /** 공개 작품 수 — **화면에 그리지 않는다**(2026-09-10). 목록 필터의 근거라 응답에는 남아 있다. */
  workCount: number;
}

/** `GET /explore` 한 쪽. `total`·`limit` 으로 다음 쪽이 있는지 판정한다. */
interface WorksPage {
  images: ExploreImage[];
  page: number;
  limit: number;
  total: number;
}

/** 기간은 [좋아요순]일 때만 뜻이 있다 — 랜덤 정렬에 기간을 걸면 아무 일도 안 일어난다. */
const PERIODS = [
  { key: 'day', label: '하루' },
  { key: 'week', label: '일주일' },
  { key: 'month', label: '한달' },
  { key: 'year', label: '1년' },
  { key: 'all', label: '전체' },
] as const;
type SortMode = 'random' | 'popular';
type Period = (typeof PERIODS)[number]['key'];

const PAGE_SIZE = 30;

/** 서버가 0·음수·문자를 'seed 없음'으로 보므로 반드시 1 이상이어야 한다. */
const newSeed = () => Math.floor(Math.random() * 1_000_000_000) + 1;

export default function ArtistsPage() {
  const [selected, setSelected] = useState<ExploreImage | null>(null);
  const [seed, setSeed] = useState(newSeed);
  const [sort, setSort] = useState<SortMode>('random');
  const [period, setPeriod] = useState<Period>('all');

  const { data: artists = [], isLoading: artistsLoading } = useQuery<ArtistEntry[]>({
    queryKey: ['explore-artists'],
    queryFn: () => api.get('/explore/artists').then((r) => r.data),
  });

  const groups = useMemo(() => groupByInitial(artists), [artists]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // ⚠️ 의존성을 `groups`(매번 새 배열) 로 두지 말 것 — 재조회 때마다 effect 가 돌아
  //    사용자가 접어 둔 칸이 제멋대로 다시 펼쳐진다. **칸 구성이 실제로 바뀌었을 때만** 되잡는다.
  const groupKey = groups.map((g) => `${g.initial}${g.artists.length}`).join('|');
  useEffect(() => {
    setExpanded(initiallyExpanded(groups, artists.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey]);

  const allOpen = groups.length > 0 && groups.every((g) => expanded.has(g.initial));
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(groups.map((g) => g.initial)));
  const toggleOne = (initial: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(initial)) next.add(initial);
      return next;
    });

  /* ── 작품 격자 — 무한스크롤 (둘러보기에서 가져왔다) ─────────────────
     ⚠️ 정렬·기간·시드가 **쿼리 키에 들어가야** 바뀔 때 1쪽부터 다시 받는다.
        빼면 [좋아요순]을 눌러도 이미 받아 둔 랜덤 페이지가 그대로 남는다. */
  const {
    data: works,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: worksLoading,
    isFetching: worksFetching,
  } = useInfiniteQuery<WorksPage>({
    queryKey: ['explore', sort, period, seed],
    queryFn: ({ pageParam = 1 }) =>
      api
        .get('/explore', { params: { page: pageParam, limit: PAGE_SIZE, sort, seed, period } })
        .then((r) => r.data),
    getNextPageParam: (last) =>
      last.page + 1 <= Math.ceil(last.total / last.limit) ? last.page + 1 : undefined,
    initialPageParam: 1,
  });
  const images: ExploreImage[] = works?.pages.flatMap((p) => p.images) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* ⚠️ `min-w-0` 필수 — 안 붙이면 오른쪽 격자의 min-content 가 트랙을 밀어
          좁은 화면에서 페이지 전체가 가로로 밀린다(CLAUDE.md 27번). */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-12">
        {/* ── 왼쪽: 작가 목록 ─────────────────────────────── */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <h1 className="font-serif text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            Art<span className="text-accent">Works</span>
          </h1>
          {/* ⚠️ 작가 수·'가나다순' 안내는 **두지 않는다**(2026-09-13 사용자 요청) — 목록을 보면 아는 것이라
              적어 두면 잔소리다. 남기는 건 실제로 누를 것 하나뿐이다. */}
          <div className="mt-2 flex h-8 items-center">
            {groups.length > 1 && (
              <button
                onClick={toggleAll}
                className="cursor-pointer py-2 text-xs text-gray-500 transition-colors hover:text-gray-900"
              >
                {allOpen ? '모두 접기' : '모두 펼치기'}
              </button>
            )}
          </div>

          {artistsLoading ? (
            <ul className="mt-5 space-y-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="h-4 w-24 animate-pulse rounded bg-gray-100" />
              ))}
            </ul>
          ) : artists.length === 0 ? (
            <p className="mt-5 text-sm text-gray-400">아직 작품을 공개한 작가가 없습니다.</p>
          ) : (
            /* ㄱ·ㄴ·ㄷ… 칸마다 접었다 편다. 칸 순서·이름 순서는 **서버가 정한 그대로** 쓴다.
               ⚠️ PC 에서 다 펼치면 세로로 길어질 수 있으므로 여기서 스크롤을 받는다 —
                  `aside` 가 sticky 라 높이를 안 묶으면 아래쪽 칸이 화면 밖으로 나가 영영 안 보인다. */
            <div className="mt-4 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pr-1">
              <ul className="space-y-1">
                {groups.map((g) => {
                  const open = expanded.has(g.initial);
                  return (
                    <li key={g.initial}>
                      <button
                        onClick={() => toggleOne(g.initial)}
                        aria-expanded={open}
                        aria-controls={`artists-${g.initial}`}
                        className="flex w-full cursor-pointer items-center gap-2 border-b border-gray-100 py-2 text-left transition-colors hover:border-gray-300"
                      >
                        {/* ⚠️ `w-7` 로 못박지 말 것 — 한글 한 글자는 들어가도 `A–Z` 는 두 줄로 꺾인다.
                            폭은 **한 글자 자리를 지키는 하한**이고, 넘치면 늘어나야 한다. */}
                        <span className="min-w-7 shrink-0 whitespace-nowrap font-serif text-base font-bold text-gray-900">
                          {g.initial}
                        </span>
                        <ChevronDown
                          size={14}
                          className={`ml-auto shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* 이름 — PC 는 한 줄에 하나, 모바일은 접히도록 흐른다(세로로 쌓으면 작품 격자가 한참 밀린다).
                          ⚠️ `<Link>` 로 둘 것 — 새 탭·주소 복사·키보드 접근이 되어야 한다(버튼이면 다 막힌다). */}
                      {open && (
                        <ul
                          id={`artists-${g.initial}`}
                          className="flex flex-wrap gap-x-4 gap-y-0.5 py-1 pl-1 lg:block lg:space-y-0.5"
                        >
                          {g.artists.map((a) => (
                            <li key={a.id} className="min-w-0">
                              <Link
                                to={artistPath(a)}
                                className="flex min-h-[34px] items-center text-sm text-gray-600 hover:text-gray-900 hover:underline hover:underline-offset-4"
                              >
                                <span className="truncate">{a.name}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        {/* ── 오른쪽: 작품 격자 (둘러보기를 흡수 — 무한스크롤·좋아요순·기간) ───── */}
        <section className="min-w-0">
          {/* 컨트롤은 [작품 새로고침] 위, [좋아요순] 아래 — 홈 ArtWorks 와 같은 글자 버튼 모양이라
              두 화면에서 누른 느낌이 같다. 알약 모양 [랜덤]/[좋아요순] 으로 되돌리지 말 것
              (랜덤이 기본이라 '랜덤' 은 버튼일 이유가 없다). */}
          <div className="mb-5 flex flex-col items-end">
            <button
              onClick={() => { setSort('random'); setSeed(newSeed()); }}
              title="다른 작품 보기 (랜덤 재정렬)"
              className="flex cursor-pointer items-center gap-1.5 py-1 text-sm text-gray-500 transition-colors hover:text-gray-900"
            >
              <RefreshCw size={15} className={worksFetching && !isFetchingNextPage ? 'animate-spin' : ''} />
              작품 새로고침
            </button>
            <button
              onClick={() => setSort(sort === 'popular' ? 'random' : 'popular')}
              aria-pressed={sort === 'popular'}
              className={`flex cursor-pointer items-center gap-1.5 py-1 text-sm transition-colors ${
                sort === 'popular' ? 'font-medium text-gray-900' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Heart size={15} className={sort === 'popular' ? 'fill-accent text-accent' : ''} />
              좋아요순
            </button>
          </div>

          {/* 기간은 좋아요순일 때만 의미가 있다 */}
          {sort === 'popular' && (
            <div className="mb-5 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-gray-400">기간</span>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`cursor-pointer rounded-full px-2.5 py-1 text-xs transition-colors ${
                    period === p.key ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {worksLoading ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse bg-gray-100" />
              ))}
            </div>
          ) : images.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">공개된 작품이 아직 없습니다.</p>
          ) : (
            <>
{/* ⚠️ 넓은 화면에서 4열로 갈 것 — 왼쪽 색인이 220px 을 먹어도 `xl` 이면 칸이 220px 이라
                  합치기 전 둘러보기(4열)와 밀도가 같다. 3열로 두면 칸이 300px 이라 훑기 화면이 성겨진다. */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 xl:grid-cols-4">
                {images.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => setSelected(img)}
                    className="group relative aspect-square cursor-pointer overflow-hidden bg-gray-50"
                    aria-label={`${displayName(img.artist)} 작가의 작품 — 크게 보기`}
                  >
                    <SkeletonImage
                      src={img.url}
                      className="absolute inset-0"
                      imgClassName="object-contain group-hover:opacity-80 transition-opacity duration-300"   /* 규칙 18 — 작품은 자르지 않는다(2026-09-19) */
                      loading="lazy"
                    />
                    {/* 그라데이션에 pointer-events-none 필수 — 없으면 아래 버튼 클릭을 막는다(CLAUDE.md 8번) */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-2">
                      <span className="truncate text-xs text-white/90">{displayName(img.artist)}</span>
                      {img.likeCount > 0 && (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-white">
                          <Heart size={11} className="fill-white" />
                          {img.likeCount}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* 무한스크롤 sentinel — ⚠️ 격자 **밖**에 둘 것. 안에 두면 격자 칸 하나로 잡혀
                  마지막 줄에 빈 칸이 생기고, 그 칸 높이(aspect-square)만큼 미리 당겨진다. */}
              <div ref={sentinelRef} className="h-10" />
              {isFetchingNextPage && (
                <div className="flex justify-center py-6">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <AnimatePresence>
        {selected && (
          <ArtworkDetailModal
            image={selected}
            onClose={() => setSelected(null)}
            onUpdate={(updated) => setSelected(updated)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
