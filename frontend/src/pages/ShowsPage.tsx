import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Heart, MapPin, Calendar, X, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import SkeletonImage from '@/components/shared/SkeletonImage';
import { regionLabels, getShowStatus, showStatusLabels } from '@/lib/utils';
import type { Show } from '@/types';

const regions = ['SEOUL', 'INCHEON', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'DAEGU', 'BUSAN', 'ULSAN'];
const statusFilters = ['ongoing', 'upcoming', 'ended'] as const;

export default function ShowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  // 필터 상태 — URL 쿼리스트링과 동기화(뒤로가기 시 필터 유지)
  const [searchParams, setSearchParams] = useSearchParams();
  const setParam = (key: string, value: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };
  const selectedRegion = searchParams.get('region');
  const setSelectedRegion = (v: string | null) => setParam('region', v);
  const selectedStatus = searchParams.get('status');
  const setSelectedStatus = (v: string | null) => setParam('status', v);
  const appliedSearch = searchParams.get('q') ?? '';
  const setAppliedSearch = (v: string) => setParam('q', v);
  const [search, setSearch] = useState(appliedSearch);

  const { data: shows = [], isLoading, isError, refetch } = useQuery<Show[]>({
    queryKey: ['shows', selectedRegion, selectedStatus, appliedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedRegion) params.set('region', selectedRegion);
      if (selectedStatus) params.set('showStatus', selectedStatus);
      if (appliedSearch) params.set('q', appliedSearch);
      return api.get(`/shows?${params}`).then(r => r.data);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const currentQueryKey = ['shows', selectedRegion, selectedStatus, appliedSearch] as const;
  const favMutation = useMutation({
    mutationFn: (showId: number) => api.post('/favorites/toggle', { showId }),
    onMutate: async (showId: number) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const prev = queryClient.getQueryData<Show[]>([...currentQueryKey]);
      if (prev) {
        queryClient.setQueryData([...currentQueryKey],
          prev.map(s => s.id === showId ? { ...s, isFavorited: !s.isFavorited } : s)
        );
      }
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData([...currentQueryKey], context.prev);
    },
    onSettled: (_data, _err, showId) => {
      queryClient.invalidateQueries({ queryKey: currentQueryKey });
      queryClient.invalidateQueries({ queryKey: ['show', String(showId)] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (selectedRegion) {
    activeFilters.push({ label: regionLabels[selectedRegion], onRemove: () => setSelectedRegion(null) });
  }
  if (selectedStatus) {
    activeFilters.push({ label: showStatusLabels[selectedStatus], onRemove: () => setSelectedStatus(null) });
  }
  if (appliedSearch) {
    activeFilters.push({ label: `"${appliedSearch}"`, onRemove: () => { setSearch(''); setAppliedSearch(''); } });
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      <div className="flex items-end justify-between gap-4 mb-10">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900">Exhibitions</h1>
          <p className="text-base text-gray-400 mt-2">지금 만날 수 있는 전시</p>
        </div>
        {user?.role === 'GALLERY' && (
          <button
            onClick={() => navigate('/mypage?tab=my-shows')}
            className="flex-none flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            <Plus size={16} /> 전시 등록
          </button>
        )}
      </div>

      {/* 검색 */}
      <form onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search.trim()); }} className="relative mb-5">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="전시 제목·장소·작가 검색"
          className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
        {search && (
          <button type="button" onClick={() => { setSearch(''); setAppliedSearch(''); }} aria-label="검색어 지우기"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        )}
      </form>

      {/* 필터 */}
      <div className="space-y-3 mb-4 text-base">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-gray-700 text-sm font-medium w-10">지역</span>
          {regions.map(r => (
            <button
              key={r}
              onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
              className={`cursor-pointer transition-colors ${
                selectedRegion === r
                  ? 'text-gray-900 underline underline-offset-4 decoration-1'
                  : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              {regionLabels[r]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-gray-700 text-sm font-medium w-10">상태</span>
          {statusFilters.map(s => (
            <button
              key={s}
              onClick={() => setSelectedStatus(selectedStatus === s ? null : s)}
              className={`cursor-pointer transition-colors ${
                selectedStatus === s
                  ? 'text-gray-900 underline underline-offset-4 decoration-1'
                  : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              {showStatusLabels[s]}
            </button>
          ))}
        </div>
      </div>

      {/* 적용된 필터 */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {activeFilters.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-sm text-gray-600">
              {f.label}
              <button onClick={f.onRemove} className="text-gray-400 hover:text-gray-900 cursor-pointer"><X size={14} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-gray-200 mb-10" />

      {/* 전시 리스트 */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map(i => <div key={i} className="h-64 bg-gray-100 animate-pulse" />)}
        </div>
      ) : isError ? (
        <div className="text-center py-20">
          <p className="text-lg text-gray-700">전시를 불러오지 못했습니다.</p>
          <p className="mt-1 text-sm text-gray-400">잠시 후 다시 시도해주세요.</p>
          <button onClick={() => refetch()} className="mt-6 px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
            다시 시도
          </button>
        </div>
      ) : shows.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">등록된 전시가 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {shows.map((show) => {
            const status = getShowStatus(show.startDate, show.endDate);
            const isAdmin = user?.role === 'ADMIN';

            return (
              <article
                key={show.id}
                onClick={() => navigate(`/shows/${show.id}`)}
                className="group cursor-pointer"
              >
                <SkeletonImage
                  src={show.posterImage}
                  alt={show.title}
                  className="aspect-[3/4]"
                  imgClassName="object-contain group-hover:opacity-80 transition-opacity duration-300"
                  blurFill
                />

                <div className="mt-3">
                  <div className="flex justify-between items-start">
                    <h3 className="text-xl font-medium text-gray-900 hover:underline underline-offset-2 decoration-1 line-clamp-1">
                      {show.title}
                    </h3>
                    <div className="flex items-center gap-2 flex-none">
                      <span className={`text-xs font-medium px-2 py-0.5 ${
                        status === 'ongoing' ? 'text-[#c4302b]' :
                        status === 'upcoming' ? 'text-gray-900' :
                        'text-gray-400'
                      }`}>
                        {showStatusLabels[status]}
                      </span>
                      {user?.role === 'ARTIST' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isAuthenticated) { toast.error('로그인이 필요합니다.'); return; }
                            favMutation.mutate(show.id);
                          }}
                          className="p-1 cursor-pointer"
                          aria-label={show.isFavorited ? '찜 해제' : '찜하기'}
                        >
                          <Heart size={16} className={show.isFavorited ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300 hover:text-gray-500'} />
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/galleries/${show.gallery?.id}`); }}
                    className="text-base text-gray-500 hover:underline mt-1 cursor-pointer"
                  >
                    {show.gallery?.name}
                  </button>

                  {show.artists && show.artists.length > 0 && (
                    <p className="text-sm text-gray-500 mt-1.5">
                      {(show.artists.length <= 3 ? show.artists : show.artists.slice(0, 3)).map((a, idx) => (
                        <span key={idx}>
                          {idx > 0 && ', '}
                          {a.userId ? (
                            <span
                              onClick={(e) => { e.stopPropagation(); navigate(`/portfolio/${a.userId}`); }}
                              className="hover:underline cursor-pointer"
                            >{a.name}</span>
                          ) : a.name}
                        </span>
                      ))}
                      {show.artists.length > 3 && ` 등 ${show.artists.length}명`}
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 mt-2 text-sm text-gray-400">
                    <Calendar size={13} />
                    <span>{formatDate(show.startDate)} ~ {formatDate(show.endDate)}</span>
                  </div>
                  <p className="flex items-center gap-1.5 mt-1 text-sm text-gray-400">
                    <MapPin size={13} /> {regionLabels[show.region]}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
