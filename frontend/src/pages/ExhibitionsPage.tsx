/**
 * ExhibitionsPage — 모집공고 찾기 (`/exhibitions`, 2026-11-15 개편)
 *
 * 고치기 전(복제본·비회원 실측): 휴대폰 공고 12개에 8,121px — 카드 한 장 580px 라 한 화면에 포스터 하나,
 * PC 는 첫 화면에 포스터만 있고 제목·마감이 안 보였다. 지역 15곳을 늘 늘어놓았는데 공고는 서울·충북·경남뿐이라 대부분 빈 화면이었다.
 *
 *  · [모집 중 | 마감] 글자 탭(다른 화면과 같은 `PageTabBar`) · 오른쪽에 [마감 임박순 | 최신 등록순]
 *  · 지역·유형은 **공고가 있는 값만**(`presentRegions`) — 건수는 그리지 않는다(사용자 결정)
 *  · 마감 임박순이면 '마감 임박 → N월 마감' 으로 묶는다(`groupByDeadline`).
 *    PC 격자는 묶음마다 줄을 끊지 않는다 — 카드 위 가는 선에 묶음 이름을 얹어 이어 흘린다(묶음이 바뀌는 자리에서 줄 끝이 비지 않게)
 *  · 휴대폰(768px 미만)은 작은 포스터 + 글의 줄 목록, 그 이상은 포스터 격자. 두 배치를 CSS 로 둘 다 그리지 않는다(useMediaQuery)
 *  · 지역·유형은 화면에서 거른다(목록은 범위·검색어로만 받는다) — 거르기 줄을 '있는 값'으로 만들려면 거르기 전 목록이 필요하다
 *
 * 마감 판정은 `lib/listings.ts deadlineView` 하나 — 상세·따라오는 [지원하기] 줄과 같은 말을 한다.
 * 주소: ?scope=closed · ?region= · ?type= · ?q= · ?sort=new (옛 링크의 ?region= 그대로 먹는다)
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import PageTabBar from '@/components/shared/PageTabBar';
import { ChoiceButton, ChoiceGroup, ListHeader } from '@/components/listing/ListControls';
import { CallCard, CallRow } from '@/components/listing/CallCards';
import { regionLabels, exhibitionTypeLabels, canFavorite, cn } from '@/lib/utils';
import { groupByDeadline, presentRegions, presentTypes, sortNewest } from '@/lib/listings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Exhibition } from '@/types';

type Scope = 'open' | 'closed';
const TABS = [{ id: 'open' as const, label: '모집 중' }, { id: 'closed' as const, label: '마감' }];

export default function ExhibitionsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const wide = useMediaQuery('(min-width: 768px)');

  // 주소와 같이 간다(뒤로 가기·주소 공유에서 그대로). replace — 거르기마다 기록이 쌓이지 않게
  const [searchParams, setSearchParams] = useSearchParams();
  const setParams = (patch: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  };
  const scope: Scope = searchParams.get('scope') === 'closed' ? 'closed' : 'open';
  const region = searchParams.get('region');
  const type = searchParams.get('type');
  const q = searchParams.get('q') ?? '';
  const sort = scope === 'open' && searchParams.get('sort') === 'new' ? 'new' : 'deadline';
  const closedTab = scope === 'closed';

  const queryKey = ['exhibitions', scope, q] as const;
  const { data: all = [], isLoading, isError, refetch } = useQuery<Exhibition[]>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (closedTab) params.set('scope', 'closed');
      if (q) params.set('q', q);
      return api.get(`/exhibitions?${params}`).then((r) => r.data);
    },
  });

  const favMutation = useMutation({
    mutationFn: (exhibitionId: number) => api.post('/favorites/toggle', { exhibitionId }),
    onMutate: async (exhibitionId: number) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<Exhibition[]>([...queryKey]);
      if (prev) queryClient.setQueryData([...queryKey], prev.map((ex) => (ex.id === exhibitionId ? { ...ex, isFavorited: !ex.isFavorited } : ex)));
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) queryClient.setQueryData([...queryKey], ctx.prev); },
    onSettled: (_d, _e, exhibitionId) => {
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibition', String(exhibitionId)] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 거르기 줄은 '다른 쪽 거르기만 건 목록'에 있는 값으로 — 지역을 고르면 그 지역에 있는 유형만, 유형을 고르면 그 유형이 있는 지역만
  const regions = useMemo(() => presentRegions(type ? all.filter((e) => e.type === type) : all, region), [all, type, region]);
  const types = useMemo(() => presentTypes(region ? all.filter((e) => e.region === region) : all, type), [all, region, type]);
  const shown = useMemo(() => {
    const rows = all.filter((e) => (!region || e.region === region) && (!type || e.type === type));
    if (closedTab) return rows;   // 서버가 최근에 끝난 순으로 준다
    return sort === 'new' ? sortNewest(rows) : rows;
  }, [all, region, type, closedTab, sort]);
  const groups = useMemo(() => (closedTab || sort === 'new' ? null : groupByDeadline(shown)), [shown, closedTab, sort]);

  const filtered = !!(region || type);
  const showFav = canFavorite(user);
  const onFav = (id: number) => favMutation.mutate(id);

  return (
    <div className="mx-auto max-w-7xl px-6 pb-16 pt-7 md:px-12 md:pt-14">
      <ListHeader
        title="Open Call"
        placeholder="공모 제목·소개 검색"
        searchLabel="공모 검색"
        applied={q}
        onApply={(v) => setParams({ q: v })}
        wide={wide}
        action={user?.role === 'GALLERY' && (
          <Link
            to="/exhibitions/new"
            className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/5"
          >
            <Plus size={15} aria-hidden /> 공모 등록
          </Link>
        )}
      />

      <div className="mt-5 md:mt-9">
        <PageTabBar
          tabs={TABS}
          active={scope}
          onSelect={(id) => setParams({ scope: id === 'closed' ? 'closed' : null, sort: null })}
          sticky={false}
          idPrefix="opencall"
          label="모집 상태"
          trailing={!closedTab && (
            <div role="group" aria-label="정렬" className="flex shrink-0 items-center gap-4 text-[13px] md:gap-5 md:text-sm">
              <ChoiceButton on={sort === 'deadline'} onClick={() => setParams({ sort: null })}>마감 임박순</ChoiceButton>
              <ChoiceButton on={sort === 'new'} onClick={() => setParams({ sort: 'new' })}>최신 등록순</ChoiceButton>
            </div>
          )}
        />
      </div>

      {/* 지역·유형 — 공고가 있는 값만. PC 는 이름표 붙은 두 묶음, 휴대폰은 옆으로 미는 한 줄([전체]가 둘 다 푼다) */}
      {(regions.length > 0 || types.length > 0) && (wide ? (
        <div className="flex flex-wrap gap-x-12 pt-1 text-[15px]">
          <ChoiceGroup label="지역" options={regions} value={region} onChange={(v) => setParams({ region: v })} nameOf={(r) => regionLabels[r] ?? r} />
          <ChoiceGroup label="유형" options={types} value={type} onChange={(v) => setParams({ type: v })} nameOf={(t) => exhibitionTypeLabels[t] ?? t} />
        </div>
      ) : (
        <div
          role="group"
          aria-label="지역·유형"
          className="-mx-6 flex items-center gap-[18px] overflow-x-auto border-b border-gray-100 px-6 text-[14px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ChoiceButton on={!filtered} onClick={() => setParams({ region: null, type: null })}>전체</ChoiceButton>
          {regions.map((r) => (
            <ChoiceButton key={r} on={region === r} onClick={() => setParams({ region: region === r ? null : r })}>{regionLabels[r] ?? r}</ChoiceButton>
          ))}
          {regions.length > 0 && types.length > 0 && <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-gray-300" />}
          {types.map((t) => (
            <ChoiceButton key={t} on={type === t} onClick={() => setParams({ type: type === t ? null : t })}>{exhibitionTypeLabels[t] ?? t}</ChoiceButton>
          ))}
          <span aria-hidden="true" className="w-2 shrink-0" />
        </div>
      ))}

      <div role="tabpanel" id={`opencall-panel-${scope}`} aria-labelledby={`opencall-tab-${scope}`}>
        {isLoading ? (
          <div className={wide ? 'mt-10 grid grid-cols-2 gap-x-7 gap-y-12 lg:grid-cols-3 xl:grid-cols-4' : 'mt-4 space-y-4'}>
            {[1, 2, 3, 4].map((i) => <div key={i} className={wide ? 'aspect-[210/297] animate-pulse bg-gray-100' : 'h-[130px] animate-pulse bg-gray-100'} />)}
          </div>
        ) : isError ? (
          <div className="py-20 text-center">
            <p className="text-lg text-gray-700">공고를 불러오지 못했습니다.</p>
            <p className="mt-1 text-sm text-gray-500">잠시 후 다시 시도해주세요.</p>
            <button onClick={() => refetch()} className="mt-6 cursor-pointer rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700">다시 시도</button>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-20 text-center text-gray-600">
            {filtered || q ? (
              <>
                <p className="text-lg">조건에 맞는 공고가 없어요.</p>
                <button type="button" onClick={() => setParams({ region: null, type: null, q: null })} className="mt-3 min-h-[44px] text-sm text-gray-900 underline underline-offset-4">
                  조건 지우기
                </button>
              </>
            ) : (
              <>
                <p className="text-lg">{closedTab ? '마감된 공고가 없어요.' : '모집 중인 공고가 없어요.'}</p>
                {!closedTab && (
                  <button type="button" onClick={() => setParams({ scope: 'closed', sort: null })} className="mt-3 min-h-[44px] text-sm text-gray-900 underline underline-offset-4">
                    마감된 공고 보기
                  </button>
                )}
              </>
            )}
          </div>
        ) : wide ? (
          <ul className="mt-8 grid grid-cols-2 gap-x-7 gap-y-12 lg:grid-cols-3 xl:grid-cols-4">
            {(groups ? groups.flatMap((g) => g.items.map((ex, i) => ({ ex, label: i === 0 ? g.label : null }))) : shown.map((ex) => ({ ex, label: null })))
              .map(({ ex, label }) => (
                <li key={ex.id} className="min-w-0">
                  {/*
                    묶음 이름은 카드 위 가는 선에 얹는다 — 묶음마다 새 줄을 시작하면 앞 묶음의 마지막 줄 끝이 빈다(사용자: "이상하지 않게").
                    카드는 끊김 없이 마감 순으로 흐르고, 묶음이 시작되는 카드만 이름과 진한 선을 갖는다(공모 상세의 일정 띠와 같은 모양)
                  */}
                  {groups && (
                    <div className="mb-4">
                      {label ? (
                        <h2 className="flex h-7 items-end pb-2 text-[13px] font-semibold text-gray-900">{label}</h2>
                      ) : <div aria-hidden="true" className="h-7" />}
                      <div aria-hidden="true" className={cn('h-0.5', label ? 'bg-gray-900' : 'bg-gray-200')} />
                    </div>
                  )}
                  <CallCard ex={ex} closedTab={closedTab} showFav={showFav} onFav={onFav} />
                </li>
              ))}
          </ul>
        ) : groups ? (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="border-b-2 border-gray-900 pb-2 pt-7 text-[13px] font-semibold text-gray-900">{g.label}</h2>
              <ul>{g.items.map((ex) => <CallRow key={ex.id} ex={ex} closedTab={closedTab} showFav={showFav} onFav={onFav} />)}</ul>
            </section>
          ))
        ) : (
          <ul className="mt-2">{shown.map((ex) => <CallRow key={ex.id} ex={ex} closedTab={closedTab} showFav={showFav} onFav={onFav} />)}</ul>
        )}
      </div>
    </div>
  );
}
