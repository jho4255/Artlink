/**
 * ShowsPage — 전시 찾기 (`/shows`, 2026-11-15 개편 — 모집공고 찾기와 같은 틀, 규칙 83)
 *
 * 고치기 전: 지역 15곳·상태 셋을 늘 늘어놓고, 카드는 3:4 포스터 + 긴 날짜('2026년 6월 1일 ~ …')·아이콘 줄이었다.
 * 진행 중인지·언제까지인지가 카드 아래쪽 회색 글자로만 있었다.
 *
 *  · [진행·예정 | 지난 전시] 글자 탭(다른 화면과 같은 `PageTabBar`)
 *  · [진행·예정] 은 '전시 중'(끝나는 날 가까운 순) → '예정'(시작 가까운 순) 으로 묶는다(`groupShows`).
 *    PC 격자는 묶음마다 줄을 끊지 않는다 — 카드 위 가는 선에 묶음 이름을 얹어 이어 흘린다(모집공고와 같다)
 *  · 기간 표시는 `showView` 하나 — `전시 중 12.20(토)까지` · 끝나기 7일 안이면 `D-3 종료` 빨강
 *  · 지역은 전시가 있는 곳만(`presentRegions`), 화면에서 거른다. 건수는 그리지 않는다
 *  · 휴대폰(768px 미만)은 작은 포스터 + 글의 줄 목록, 그 이상은 포스터 격자(useMediaQuery 로 하나만)
 *
 * 주소: ?scope=past · ?region= · ?q= (옛 링크의 ?status=ended 는 [지난 전시], ongoing·upcoming 은 [진행·예정])
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import PageTabBar from '@/components/shared/PageTabBar';
import { ChoiceButton, ChoiceGroup, ListHeader } from '@/components/listing/ListControls';
import { ShowCard, ShowRow } from '@/components/listing/ShowCards';
import { regionLabels, canFavorite, cn } from '@/lib/utils';
import { groupShows, presentRegions, showView, sortEnded } from '@/lib/listings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Show } from '@/types';

type Scope = 'now' | 'past';
const TABS = [{ id: 'now' as const, label: '진행·예정' }, { id: 'past' as const, label: '지난 전시' }];

export default function ShowsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const wide = useMediaQuery('(min-width: 768px)');

  const [searchParams, setSearchParams] = useSearchParams();
  const setParams = (patch: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      next.delete('status');   // 옛 주소의 상태 거르기는 탭으로 옮겼다
      return next;
    }, { replace: true });
  };
  const scope: Scope = searchParams.get('scope') === 'past' || searchParams.get('status') === 'ended' ? 'past' : 'now';
  const region = searchParams.get('region');
  const q = searchParams.get('q') ?? '';
  const past = scope === 'past';

  // 승인된 전시 전부(서버가 시작일 순으로 준다) — 탭·지역은 화면에서 가른다(거르기 줄을 '있는 값'으로 만들려면 거르기 전 목록이 필요하다)
  const queryKey = ['shows', 'all', q] as const;
  const { data: all = [], isLoading, isError, refetch } = useQuery<Show[]>({
    queryKey,
    queryFn: () => api.get(`/shows${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.data),
  });

  const favMutation = useMutation({
    mutationFn: (showId: number) => api.post('/favorites/toggle', { showId }),
    onMutate: async (showId: number) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<Show[]>([...queryKey]);
      if (prev) queryClient.setQueryData([...queryKey], prev.map((s) => (s.id === showId ? { ...s, isFavorited: !s.isFavorited } : s)));
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) queryClient.setQueryData([...queryKey], ctx.prev); },
    onSettled: (_d, _e, showId) => {
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['show', String(showId)] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const inScope = useMemo(() => all.filter((s) => (showView(s).state === 'ended') === past), [all, past]);
  const regions = useMemo(() => presentRegions(inScope, region), [inScope, region]);
  const shown = useMemo(() => {
    const rows = inScope.filter((s) => !region || s.region === region);
    return past ? sortEnded(rows) : rows;
  }, [inScope, region, past]);
  const groups = useMemo(() => (past ? null : groupShows(shown)), [shown, past]);
  const ordered = groups ? groups.flatMap((g) => g.items) : shown;

  const showFav = canFavorite(user);
  const onFav = (id: number) => favMutation.mutate(id);

  return (
    <div className="mx-auto max-w-7xl px-6 pb-16 pt-7 md:px-12 md:pt-14">
      <ListHeader
        title="Exhibitions"
        placeholder="전시 제목·장소·작가 검색"
        searchLabel="전시 검색"
        applied={q}
        onApply={(v) => setParams({ q: v })}
        wide={wide}
        action={user?.role === 'GALLERY' && (
          <Link
            to="/shows/new"
            className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/5"
          >
            <Plus size={15} aria-hidden /> 전시 등록
          </Link>
        )}
      />

      <div className="mt-5 md:mt-9">
        <PageTabBar
          tabs={TABS}
          active={scope}
          onSelect={(id) => setParams({ scope: id === 'past' ? 'past' : null })}
          sticky={false}
          idPrefix="shows"
          label="전시 상태"
        />
      </div>

      {/* 지역 — 전시가 있는 곳만. PC 는 이름표 붙은 묶음, 휴대폰은 옆으로 미는 한 줄 */}
      {regions.length > 0 && (wide ? (
        <div className="flex flex-wrap gap-x-12 pt-1 text-[15px]">
          <ChoiceGroup label="지역" options={regions} value={region} onChange={(v) => setParams({ region: v })} nameOf={(r) => regionLabels[r] ?? r} />
        </div>
      ) : (
        <div role="group" aria-label="지역" className="-mx-6 flex items-center gap-[18px] overflow-x-auto border-b border-gray-100 px-6 text-[14px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ChoiceButton on={!region} onClick={() => setParams({ region: null })}>전체</ChoiceButton>
          {regions.map((r) => (
            <ChoiceButton key={r} on={region === r} onClick={() => setParams({ region: region === r ? null : r })}>{regionLabels[r] ?? r}</ChoiceButton>
          ))}
          <span aria-hidden="true" className="w-2 shrink-0" />
        </div>
      ))}

      <div role="tabpanel" id={`shows-panel-${scope}`} aria-labelledby={`shows-tab-${scope}`}>
        {isLoading ? (
          <div className={wide ? 'mt-10 grid grid-cols-2 gap-x-7 gap-y-12 lg:grid-cols-3 xl:grid-cols-4' : 'mt-4 space-y-4'}>
            {[1, 2, 3, 4].map((i) => <div key={i} className={wide ? 'aspect-[210/297] animate-pulse bg-gray-100' : 'h-[130px] animate-pulse bg-gray-100'} />)}
          </div>
        ) : isError ? (
          <div className="py-20 text-center">
            <p className="text-lg text-gray-700">전시를 불러오지 못했습니다.</p>
            <p className="mt-1 text-sm text-gray-500">잠시 후 다시 시도해주세요.</p>
            <button onClick={() => refetch()} className="mt-6 cursor-pointer rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700">다시 시도</button>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-20 text-center text-gray-600">
            {region || q ? (
              <>
                <p className="text-lg">조건에 맞는 전시가 없어요.</p>
                <button type="button" onClick={() => setParams({ region: null, q: null })} className="mt-3 min-h-[44px] text-sm text-gray-900 underline underline-offset-4">
                  조건 지우기
                </button>
              </>
            ) : (
              <>
                <p className="text-lg">{past ? '지난 전시가 없어요.' : '진행 중이거나 예정된 전시가 없어요.'}</p>
                {!past && (
                  <button type="button" onClick={() => setParams({ scope: 'past' })} className="mt-3 min-h-[44px] text-sm text-gray-900 underline underline-offset-4">
                    지난 전시 보기
                  </button>
                )}
              </>
            )}
          </div>
        ) : wide ? (
          <ul className="mt-8 grid grid-cols-2 gap-x-7 gap-y-12 lg:grid-cols-3 xl:grid-cols-4">
            {ordered.map((s) => {
              const g = groups?.find((x) => x.items[0]?.id === s.id);
              return (
                <li key={s.id} className="min-w-0">
                  {/* 묶음 이름은 카드 위 가는 선에 — 묶음마다 새 줄을 시작하면 앞 줄 끝이 빈다(모집공고와 같은 모양) */}
                  {groups && (
                    <div className="mb-4">
                      {g ? <h2 className="flex h-7 items-end pb-2 text-[13px] font-semibold text-gray-900">{g.label}</h2> : <div aria-hidden="true" className="h-7" />}
                      <div aria-hidden="true" className={cn('h-0.5', g ? 'bg-gray-900' : 'bg-gray-200')} />
                    </div>
                  )}
                  <ShowCard show={s} showFav={showFav} onFav={onFav} />
                </li>
              );
            })}
          </ul>
        ) : groups ? (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="border-b-2 border-gray-900 pb-2 pt-7 text-[13px] font-semibold text-gray-900">{g.label}</h2>
              <ul>{g.items.map((s) => <ShowRow key={s.id} show={s} showFav={showFav} onFav={onFav} />)}</ul>
            </section>
          ))
        ) : (
          <ul className="mt-2">{shown.map((s) => <ShowRow key={s.id} show={s} showFav={showFav} onFav={onFav} />)}</ul>
        )}
      </div>
    </div>
  );
}
