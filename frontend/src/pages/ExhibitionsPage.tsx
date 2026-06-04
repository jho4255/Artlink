import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Heart, Users, MapPin, X, Send, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import SkeletonImage from '@/components/shared/SkeletonImage';
import { getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { Exhibition } from '@/types';

const regions = ['SEOUL', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'BUSAN'];

export default function ExhibitionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [minGalleryRating, setMinGalleryRating] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [applyTerms, setApplyTerms] = useState('');
  const [applyConfirmId, setApplyConfirmId] = useState<number | null>(null);

  useEffect(() => {
    fetch('/terms/artist_apply_real.txt')
      .then(r => {
        if (!r.ok || r.headers.get('content-type')?.includes('text/html')) {
          throw new Error('not text');
        }
        return r.text();
      })
      .then(text => {
        if (!text.trimStart().startsWith('<!') && !text.trimStart().startsWith('<html')) {
          setApplyTerms(text);
        }
      })
      .catch(() => setApplyTerms('이 공모에 지원하시겠습니까? 포트폴리오가 갤러리에 전송됩니다.'));
  }, []);

  const exhibitionTypes = ['SOLO', 'GROUP', 'ART_FAIR'];

  const { data: exhibitions = [], isLoading, isError, refetch } = useQuery<Exhibition[]>({
    queryKey: ['exhibitions', selectedRegion, minGalleryRating, selectedType, appliedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedRegion) params.set('region', selectedRegion);
      if (minGalleryRating) params.set('minGalleryRating', String(minGalleryRating));
      if (selectedType) params.set('type', selectedType);
      if (appliedSearch) params.set('q', appliedSearch);
      return api.get(`/exhibitions?${params}`).then(r => r.data);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const applyMutation = useMutation({
    mutationFn: (exhibitionId: number) => api.post(`/exhibitions/${exhibitionId}/apply`),
    onSuccess: () => {
      toast.success('지원이 완료되었습니다! 포트폴리오가 갤러리에 전송됩니다.');
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || '지원 중 오류가 발생했습니다.');
    },
  });

  const currentQueryKey = ['exhibitions', selectedRegion, minGalleryRating, selectedType, appliedSearch] as const;
  const favMutation = useMutation({
    mutationFn: (exhibitionId: number) => api.post('/favorites/toggle', { exhibitionId }),
    onMutate: async (exhibitionId: number) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const prev = queryClient.getQueryData<Exhibition[]>([...currentQueryKey]);
      if (prev) {
        queryClient.setQueryData([...currentQueryKey],
          prev.map(ex => ex.id === exhibitionId ? { ...ex, isFavorited: !ex.isFavorited } : ex)
        );
      }
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData([...currentQueryKey], context.prev);
    },
    onSettled: (_data, _err, exhibitionId) => {
      queryClient.invalidateQueries({ queryKey: currentQueryKey });
      queryClient.invalidateQueries({ queryKey: ['exhibition', String(exhibitionId)] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (selectedRegion) {
    activeFilters.push({ label: regionLabels[selectedRegion], onRemove: () => setSelectedRegion(null) });
  }
  if (minGalleryRating) {
    activeFilters.push({ label: `갤러리 ${minGalleryRating}점+`, onRemove: () => setMinGalleryRating(null) });
  }
  if (selectedType) {
    activeFilters.push({ label: exhibitionTypeLabels[selectedType], onRemove: () => setSelectedType(null) });
  }
  if (appliedSearch) {
    activeFilters.push({ label: `"${appliedSearch}"`, onRemove: () => { setSearch(''); setAppliedSearch(''); } });
  }

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      <div className="flex items-end justify-between gap-4 mb-10">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900">Open Call</h1>
          <p className="text-base text-gray-400 mt-2">진행 중인 공모를 확인하세요</p>
        </div>
        {user?.role === 'GALLERY' && (
          <button
            onClick={() => navigate('/mypage?tab=my-exhibitions')}
            className="flex-none flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            <Plus size={16} /> 공모 등록
          </button>
        )}
      </div>

      {/* 검색 */}
      <form onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search.trim()); }} className="relative mb-5">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="공모 제목·소개 검색"
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
          <span className="text-gray-700 text-sm font-medium w-10">유형</span>
          {exhibitionTypes.map(t => (
            <button
              key={t}
              onClick={() => setSelectedType(selectedType === t ? null : t)}
              className={`cursor-pointer transition-colors ${
                selectedType === t
                  ? 'text-gray-900 underline underline-offset-4 decoration-1'
                  : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              {exhibitionTypeLabels[t]}
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

      {/* 공모 리스트 */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map(i => <div key={i} className="h-64 bg-gray-100 animate-pulse" />)}
        </div>
      ) : isError ? (
        <div className="text-center py-20">
          <p className="text-lg text-gray-700">공고를 불러오지 못했습니다.</p>
          <p className="mt-1 text-sm text-gray-400">잠시 후 다시 시도해주세요.</p>
          <button onClick={() => refetch()} className="mt-6 px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
            다시 시도
          </button>
        </div>
      ) : exhibitions.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">진행 중인 공고가 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {exhibitions.map((ex) => {
            const dday = getDday(ex.deadline);
            const isAdmin = user?.role === 'ADMIN';

            return (
              <article
                key={ex.id}
                onClick={() => navigate(`/exhibitions/${ex.id}`)}
                className="group cursor-pointer"
              >
                <SkeletonImage
                  src={ex.imageUrl || ex.gallery?.mainImage || ''}
                  alt={ex.title}
                  fallbackLabel={ex.title}
                  className="aspect-[4/3]"
                  imgClassName="object-contain group-hover:opacity-80 transition-opacity duration-300"
                  blurFill
                />

                <div className="mt-3">
                  <div className="flex justify-between items-start">
                    <h3 className="text-xl font-medium text-gray-900 hover:underline underline-offset-2 decoration-1 line-clamp-1">
                      {ex.title}
                    </h3>
                    <div className="flex items-center gap-2 flex-none">
                      <span className={`text-sm font-medium ${dday <= 7 ? 'text-[#6366f1]' : 'text-gray-500'}`}>
                        D-{dday}
                      </span>
                      {isAuthenticated && !isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); favMutation.mutate(ex.id); }}
                          className="p-1 cursor-pointer"
                          aria-label={ex.isFavorited ? '찜 해제' : '찜하기'}
                        >
                          <Heart size={16} className={ex.isFavorited ? 'text-[#6366f1] fill-[#6366f1]' : 'text-gray-300 hover:text-gray-500'} />
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/galleries/${ex.gallery?.id}`); }}
                    className="text-base text-gray-500 hover:underline mt-1 cursor-pointer"
                  >
                    {ex.gallery?.name}
                  </button>

                  <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-400">
                    <span>{exhibitionTypeLabels[ex.type]}</span>
                    <span className="flex items-center gap-1"><Users size={13} /> {ex.capacity}명</span>
                    <span className="flex items-center gap-1"><MapPin size={13} /> {regionLabels[ex.region]}</span>
                  </div>

                  {user?.role === 'ARTIST' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (ex.customFields && ex.customFields.length > 0) {
                          toast('추가 정보 입력이 필요합니다. 상세페이지로 이동합니다.', { icon: '📝' });
                          navigate(`/exhibitions/${ex.id}`);
                        } else {
                          setApplyConfirmId(ex.id);
                        }
                      }}
                      disabled={applyMutation.isPending}
                      className="mt-3 text-sm text-gray-900 underline underline-offset-4 decoration-1 hover:text-[#6366f1] transition-colors cursor-pointer"
                    >
                      지원하기 →
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={applyConfirmId !== null}
        title="지원하기"
        message={applyTerms || '지원하시겠습니까?'}
        confirmText="지원하기"
        onConfirm={() => { applyMutation.mutate(applyConfirmId!); setApplyConfirmId(null); }}
        onCancel={() => setApplyConfirmId(null)}
      />
    </div>
  );
}
