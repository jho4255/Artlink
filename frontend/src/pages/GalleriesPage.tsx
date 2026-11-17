/**
 * GalleriesPage — 갤러리 찾기 (`/galleries`, 2026-11-15 개편)
 *
 * 작가가 갤러리를 고르는 이유는 리뷰·전화번호가 아니라 "지금 작가를 뽑는가 / 무슨 전시를 하는가"다.
 * 고치기 전(복제본): 11곳 전부 '아직 리뷰 없음' · 카드마다 전화번호 · 모집·전시 신호 없음 · [리뷰순]을 눌러도 순서가 그대로였다.
 *
 *  · 카드: 사진 · 이름 · 동네(`addressArea`)·리뷰 수(있을 때만) · 한 줄 소개 · **모집 중**(마감 가까운 공모, 외 N) · **전시 중/예정**
 *    — 둘 다 서버가 같이 내려준다(`GET /galleries` 의 openCall · nowShow, 모집 중 규칙은 모집공고 [모집 중] 과 같다)
 *  · 순서(기본) = 모집 중인 갤러리 먼저, 그 안은 누적 조회수 순 — **기준은 화면에 적지 않는다**(사용자 결정). [리뷰순]은 그대로
 *  · 지역은 갤러리가 있는 곳만(`presentRegions`), 건수는 그리지 않는다 · 지역은 화면에서 거른다(거르기 줄을 만들려면 거르기 전 목록이 필요)
 *  · 휴대폰(768px 미만)은 줄 목록, 그 이상은 격자. 둥근 모서리·사진 색 그림자는 없앴다(DESIGN.md)
 *
 * ⚠️ 별점은 2026-09-10 에 없앴다 — 별점 필터·정렬을 되살리지 말 것(서버도 `minRating` 을 무시한다).
 * API: GET /api/galleries?q=&sortBy=reviewCount
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, canFavorite } from '@/lib/utils';
import { ChoiceButton, ListHeader } from '@/components/listing/ListControls';
import { GalleryCard, GalleryRow } from '@/components/listing/GalleryCards';
import { presentRegions } from '@/lib/listings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Gallery } from '@/types';

export default function GalleriesPage() {
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
      return next;
    }, { replace: true });
  };
  const region = searchParams.get('region');
  const sortBy = searchParams.get('sortBy') === 'reviewCount' ? 'reviewCount' : null;
  const q = searchParams.get('q') ?? '';

  const queryKey = ['galleries', sortBy, q] as const;
  const { data: all = [], isLoading, isError, refetch } = useQuery<Gallery[]>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (sortBy) params.set('sortBy', sortBy);
      if (q) params.set('q', q);
      return api.get(`/galleries?${params}`).then((r) => r.data);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 찜 — 낙관적 갱신(CLAUDE.md Key Patterns)
  const favMutation = useMutation({
    mutationFn: (galleryId: number) => api.post('/favorites/toggle', { galleryId }),
    onMutate: async (galleryId: number) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<Gallery[]>([...queryKey]);
      if (prev) queryClient.setQueryData([...queryKey], prev.map((g) => (g.id === galleryId ? { ...g, isFavorited: !g.isFavorited } : g)));
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) queryClient.setQueryData([...queryKey], ctx.prev); },
    onSettled: (_d, _e, galleryId) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['gallery', String(galleryId)] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const regions = useMemo(() => presentRegions(all, region), [all, region]);
  const shown = useMemo(() => (region ? all.filter((g) => g.region === region) : all), [all, region]);
  const showFav = canFavorite(user);
  const onFav = (id: number) => favMutation.mutate(id);

  const sortRow = (
    <div role="group" aria-label="정렬" className="flex shrink-0 items-center gap-4 text-[13px] md:gap-5 md:text-sm">
      <ChoiceButton on={!sortBy} onClick={() => setParams({ sortBy: null })}>모집 중 먼저</ChoiceButton>
      <ChoiceButton on={sortBy === 'reviewCount'} onClick={() => setParams({ sortBy: 'reviewCount' })}>리뷰순</ChoiceButton>
    </div>
  );
  const regionButtons = (
    <>
      <ChoiceButton on={!region} onClick={() => setParams({ region: null })}>전체</ChoiceButton>
      {regions.map((r) => (
        <ChoiceButton key={r} on={region === r} onClick={() => setParams({ region: region === r ? null : r })}>{regionLabels[r] ?? r}</ChoiceButton>
      ))}
    </>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 pb-16 pt-7 md:px-12 md:pt-14">
      <ListHeader
        title="Galleries"
        placeholder="갤러리 이름·주소 검색"
        searchLabel="갤러리 검색"
        applied={q}
        onApply={(v) => setParams({ q: v })}
        wide={wide}
        action={user?.role === 'GALLERY' && (
          <Link
            to="/galleries/new"
            className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/5"
          >
            <Plus size={15} aria-hidden /> 갤러리 등록
          </Link>
        )}
      />

      {/* 지역(있는 곳만) · 정렬 — PC 는 한 줄, 휴대폰은 지역 줄(옆으로 민다) 아래 정렬 */}
      {wide ? (
        <div className="mt-9 flex flex-wrap items-center justify-between gap-x-8 border-b border-gray-200 text-[15px]">
          <div role="group" aria-label="지역" className="flex flex-wrap items-center gap-x-5">{regionButtons}</div>
          {sortRow}
        </div>
      ) : (
        <>
          <div role="group" aria-label="지역" className="-mx-6 mt-5 flex items-center gap-5 overflow-x-auto border-b border-gray-200 px-6 text-[15px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {regionButtons}
            <span aria-hidden="true" className="w-2 shrink-0" />
          </div>
          <div className="flex justify-end">{sortRow}</div>
        </>
      )}

      {isLoading ? (
        <div className={wide ? 'mt-9 grid grid-cols-2 gap-x-8 gap-y-12 lg:grid-cols-3' : 'mt-2 space-y-4'}>
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className={wide ? 'aspect-[4/3] animate-pulse bg-gray-100' : 'h-[110px] animate-pulse bg-gray-100'} />)}
        </div>
      ) : isError ? (
        <div className="py-20 text-center">
          <p className="text-lg text-gray-700">갤러리를 불러오지 못했습니다.</p>
          <p className="mt-1 text-sm text-gray-500">잠시 후 다시 시도해주세요.</p>
          <button onClick={() => refetch()} className="mt-6 cursor-pointer rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700">다시 시도</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="py-20 text-center text-gray-600">
          <p className="text-lg">조건에 맞는 갤러리가 없어요.</p>
          {(region || q) && (
            <button type="button" onClick={() => setParams({ region: null, q: null })} className="mt-3 min-h-[44px] text-sm text-gray-900 underline underline-offset-4">
              조건 지우기
            </button>
          )}
        </div>
      ) : wide ? (
        <ul className="mt-9 grid grid-cols-2 gap-x-8 gap-y-12 lg:grid-cols-3">
          {shown.map((g) => <li key={g.id} className="min-w-0"><GalleryCard g={g} showFav={showFav} onFav={onFav} /></li>)}
        </ul>
      ) : (
        <ul className="border-t border-gray-100">
          {shown.map((g) => <GalleryRow key={g.id} g={g} showFav={showFav} onFav={onFav} />)}
        </ul>
      )}
    </div>
  );
}
