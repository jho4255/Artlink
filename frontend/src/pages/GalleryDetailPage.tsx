/**
 * GalleryDetailPage - 갤러리 상세 페이지
 *
 * 기능:
 *  - 상단 이미지 슬라이더 (좌우 화살표 네비게이션)
 *  - 우상단 찜하기(하트) 버튼
 *  - 갤러리 기본정보: 이름, 주소, 별점, 한줄소개
 *  - 상세소개: 갤러리 오너만 수정 버튼 표시
 *  - 진행중인 공모 목록 (D-day 표시)
 *  - 리뷰 섹션:
 *    - Artist 전용 리뷰 작성 폼 (별점, 텍스트, 사진 옵션, 익명 체크박스)
 *    - 익명 리뷰 시 "익명의 예술가 N" 표기
 *    - Admin은 리뷰 삭제 버튼 표시
 *
 * API:
 *  - GET /api/galleries/:id - 갤러리 상세 조회
 *  - POST /api/favorites/toggle - 찜하기 토글
 *  - PATCH /api/galleries/:id/detail - 상세소개 수정
 *  - POST /api/reviews - 리뷰 작성
 *  - DELETE /api/reviews/:id - 리뷰 삭제
 *
 * @see /src/lib/axios.ts - API 인스턴스
 * @see /src/lib/utils.ts - getDday, regionLabels, exhibitionTypeLabels
 * @see /src/types/index.ts - Gallery, Review, Exhibition 타입
 * @see /src/stores/authStore.ts - 인증 상태 및 유저 정보
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Star, ChevronLeft, ChevronRight, MapPin, Phone, Clock, Trash2, Camera, X, Edit3, Instagram, Mail, Plus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { extractColor } from '@/lib/extractColor';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import ImageUpload from '@/components/shared/ImageUpload';
import ImageLightbox from '@/components/shared/ImageLightbox';
import InstagramFeed from '@/components/gallery/InstagramFeed';
import InstagramPrivateMessage from '@/components/gallery/InstagramPrivateMessage';
import type { Gallery, Review, Exhibition, PromoPhoto } from '@/types';

// 갤러리 상세 응답 타입 (기본 Gallery + 연관 데이터)
type GalleryDetail = Gallery & {
  exhibitions: Exhibition[];
  reviews: Review[];
  owner: { id: number };
};

export default function GalleryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  // 이미지 슬라이더 인덱스
  const [imgIndex, setImgIndex] = useState(0);
  const [bgColor, setBgColor] = useState('#1a1a2e');

  // 한줄소개 수정 상태
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descText, setDescText] = useState('');

  // 상세소개 수정 상태
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [detailDesc, setDetailDesc] = useState('');

  // 홍보 사진 업로드 폼 상태 (전시 종료 후, 갤러리 오너 전용)
  const [promoExhibitionId, setPromoExhibitionId] = useState<number | null>(null);
  const [promoUrl, setPromoUrl] = useState('');
  const [promoCaption, setPromoCaption] = useState('');

  // 이미지 확대 Lightbox 상태
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  // 리뷰 작성/수정 폼 상태
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewContent, setReviewContent] = useState('');
  const [reviewAnonymous, setReviewAnonymous] = useState(false);
  const [reviewImageUrl, setReviewImageUrl] = useState('');
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);

  // 갤러리 상세 조회
  const { data: gallery, isLoading } = useQuery<GalleryDetail>({
    queryKey: ['gallery', id],
    queryFn: () => api.get(`/galleries/${id}`).then(r => r.data),
    enabled: !!id,
  });

  // 찜하기 토글 - 낙관적 업데이트로 즉시 반영
  const favMutation = useMutation({
    mutationFn: () => api.post('/favorites/toggle', { galleryId: Number(id) }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['gallery', id] });
      const prev = queryClient.getQueryData<GalleryDetail>(['gallery', id]);
      if (prev) {
        queryClient.setQueryData(['gallery', id], { ...prev, isFavorited: !prev.isFavorited });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['gallery', id], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 한줄소개 수정 (갤러리 오너 전용)
  const descMutation = useMutation({
    mutationFn: (description: string) => api.patch(`/galleries/${id}/detail`, { description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      setIsEditingDesc(false);
      toast.success('한줄 소개가 수정되었습니다.');
    },
    onError: () => toast.error('수정에 실패했습니다.'),
  });

  // 상세소개 수정 (갤러리 오너 전용)
  const detailMutation = useMutation({
    mutationFn: (desc: string) => api.patch(`/galleries/${id}/detail`, { detailDesc: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      setIsEditingDetail(false);
    },
  });

  // 리뷰 작성 (Artist 전용)
  const reviewMutation = useMutation({
    mutationFn: (data: { galleryId: number; rating: number; content: string; anonymous: boolean; imageUrl?: string }) =>
      api.post('/reviews', data),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      // 폼 초기화
      setReviewContent('');
      setReviewRating(5);
      setReviewAnonymous(false);
      setReviewImageUrl('');
    },
  });

  // 리뷰 수정 (작성자 본인)
  const updateReviewMutation = useMutation({
    mutationFn: (data: { reviewId: number; rating: number; content: string; anonymous: boolean; imageUrl?: string }) =>
      api.patch(`/reviews/${data.reviewId}`, { rating: data.rating, content: data.content, anonymous: data.anonymous, imageUrl: data.imageUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
      setEditingReviewId(null);
      setReviewContent('');
      setReviewRating(5);
      setReviewAnonymous(false);
      setReviewImageUrl('');
      toast.success('리뷰가 수정되었습니다.');
    },
    onError: () => toast.error('리뷰 수정에 실패했습니다.'),
  });

  // 리뷰 삭제 (Admin 또는 작성자 본인)
  const deleteReviewMutation = useMutation({
    mutationFn: (reviewId: number) => api.delete(`/reviews/${reviewId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
      toast.success('리뷰가 삭제되었습니다.');
    },
    onError: () => toast.error('리뷰 삭제에 실패했습니다.'),
  });

  // 홍보 사진 등록 (Gallery 오너 전용, 전시 종료 후)
  const promoPhotoMutation = useMutation({
    mutationFn: (data: { exhibitionId: number; url: string; caption: string }) =>
      api.post(`/exhibitions/${data.exhibitionId}/promo-photos`, { url: data.url, caption: data.caption }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      setPromoExhibitionId(null);
      setPromoUrl('');
      setPromoCaption('');
      toast.success('홍보 사진이 등록되었습니다.');
    },
    onError: () => toast.error('홍보 사진 등록에 실패했습니다.'),
  });

  // 공모 삭제 (Gallery 오너 또는 Admin)
  const deleteExhibitionMutation = useMutation({
    mutationFn: (exhibitionId: number) => api.delete(`/exhibitions/${exhibitionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      toast.success('공모가 삭제되었습니다.');
    },
    onError: () => toast.error('공모 삭제에 실패했습니다.'),
  });

  // 갤러리 삭제 (Gallery 오너 또는 Admin)
  const deleteGalleryMutation = useMutation({
    mutationFn: () => api.delete(`/galleries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('갤러리가 삭제되었습니다.');
      navigate('/galleries');
    },
    onError: () => toast.error('갤러리 삭제에 실패했습니다.'),
  });

  // 홍보 사진 삭제 (Gallery 오너 전용)
  const deletePromoPhotoMutation = useMutation({
    mutationFn: ({ exhibitionId, photoId }: { exhibitionId: number; photoId: number }) =>
      api.delete(`/exhibitions/${exhibitionId}/promo-photos/${photoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      toast.success('홍보 사진이 삭제되었습니다.');
    },
    onError: () => toast.error('홍보 사진 삭제에 실패했습니다.'),
  });

  // 이미지 dominant color 추출
  useEffect(() => {
    const src = gallery?.mainImage || gallery?.images?.[0]?.url;
    if (src) extractColor(src).then(setBgColor);
  }, [gallery?.mainImage, gallery?.images]);

  // 로딩 스켈레톤
  if (isLoading || !gallery) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse mb-4" />
        <div className="h-8 bg-gray-100 rounded w-1/3 animate-pulse mb-2" />
        <div className="h-4 bg-gray-100 rounded w-2/3 animate-pulse" />
      </div>
    );
  }

  // 이미지 목록 구성 (images 배열 -> mainImage -> 기본 이미지 순으로 fallback)
  const images = gallery.images?.length > 0
    ? gallery.images.map(img => img.url)
    : [gallery.mainImage || 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800'];

  // 권한 체크
  const isOwner = user?.id === gallery.ownerId;
  const isAdmin = user?.role === 'ADMIN';
  const isArtist = user?.role === 'ARTIST';

  /**
   * 익명 리뷰어 이름 생성
   * - 익명이 아닌 경우: 실명 표시
   * - 익명인 경우: "익명의 예술가 N" (순서대로 번호 부여)
   * - Admin 또는 본인이 작성한 리뷰는 실명 + (익명) 표시
   */
  let anonCounter = 0;
  const getReviewerName = (review: Review) => {
    if (review.anonymous) {
      if (isAdmin || review.userId === user?.id) {
        return `${review.user.name} (익명)`;
      }
      anonCounter++;
      return `익명의 예술가 ${anonCounter}`;
    }
    return review.user.name;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto px-6 md:px-12 pb-12">
      {/* === 이미지 캐러셀 + glow shadow === */}
      <div className="py-6 md:py-10">
        <div
          className="max-w-4xl mx-auto overflow-hidden rounded-lg transition-shadow duration-700"
          style={{ boxShadow: `0 8px 40px ${bgColor}, 0 2px 12px ${bgColor}` }}
        >
          <GalleryImageCarousel
            images={images}
            galleryName={gallery.name}
            imgIndex={imgIndex}
            setImgIndex={setImgIndex}
            onImageClick={(index) => setLightbox({ images, index })}
            isFavorited={!!gallery.isFavorited}
            showFavorite={isAuthenticated && !isAdmin}
            onFavoriteClick={() => favMutation.mutate()}
          />
        </div>
      </div>

      {/* === 오너 전용: 이미지 관리 패널 === */}
      {isOwner && (
        <GalleryImageManager
          galleryId={Number(id)}
          galleryImages={gallery.images || []}
          onImgIndexGuard={(maxIdx) => {
            if (imgIndex > maxIdx) setImgIndex(Math.max(0, maxIdx));
          }}
        />
      )}

      <div className="px-4 py-6 space-y-8">
        {/* === 기본 정보 섹션 === */}
        <div>
          <h1 className="text-3xl md:text-4xl font-medium">{gallery.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Star size={16} className="text-[#c4302b] fill-[#c4302b]" />
            <span className="font-medium">{gallery.rating.toFixed(1)}</span>
            <span className="text-gray-400 text-sm">({gallery.reviewCount}개 리뷰)</span>
          </div>
          <p className="text-gray-600 mt-2 flex items-center gap-1"><MapPin size={14} /> {gallery.address}</p>
          {/* 모바일: tel: 링크로 다이얼러 연결, 데스크톱: 일반 텍스트 */}
          <a href={`tel:${gallery.phone}`} className="text-gray-600 flex items-center gap-1 md:hidden active:text-gray-900">
            <Phone size={14} /> <span className="underline">{gallery.phone}</span>
          </a>
          <p className="text-gray-600 hidden md:flex items-center gap-1"><Phone size={14} /> {gallery.phone}</p>
          {gallery.email && (
            <p className="text-gray-600 flex items-center gap-1"><Mail size={14} /> {gallery.email}</p>
          )}
          {gallery.instagramUrl && (
            <a
              href={gallery.instagramUrl.startsWith('http') ? gallery.instagramUrl : `https://instagram.com/${gallery.instagramUrl.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:underline flex items-center gap-1"
            >
              <Instagram size={14} /> {gallery.instagramUrl}
            </a>
          )}
          {isEditingDesc ? (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                value={descText}
                onChange={e => setDescText(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                placeholder="한줄 소개를 입력해주세요"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (!descText.trim()) { toast.error('소개를 입력해주세요.'); return; }
                    descMutation.mutate(descText);
                  }}
                  disabled={descMutation.isPending}
                  className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  onClick={() => setIsEditingDesc(false)}
                  className="px-4 py-1.5 text-sm text-gray-500"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 mt-2">
              <p className="text-gray-700">{gallery.description}</p>
              {isOwner && (
                <button
                  onClick={() => { setDescText(gallery.description || ''); setIsEditingDesc(true); }}
                  className="flex-none text-gray-400 hover:text-gray-900 mt-0.5"
                  title="한줄 소개 수정"
                >
                  <Edit3 size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* === 상세 소개 섹션 === */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-medium">상세 소개</h2>
            {/* 갤러리 오너만 수정 버튼 표시 */}
            {isOwner && !isEditingDetail && (
              <button
                onClick={() => { setDetailDesc(gallery.detailDesc || ''); setIsEditingDetail(true); }}
                className="text-sm text-gray-400 hover:text-gray-900"
              >
                수정
              </button>
            )}
          </div>
          {isEditingDetail ? (
            <div className="space-y-2">
              <textarea
                value={detailDesc}
                onChange={e => setDetailDesc(e.target.value)}
                className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => detailMutation.mutate(detailDesc)}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg"
                >
                  저장
                </button>
                <button
                  onClick={() => setIsEditingDetail(false)}
                  className="px-4 py-2 text-sm text-gray-500"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-600 whitespace-pre-wrap">
              {gallery.detailDesc || '상세 소개가 등록되지 않았습니다.'}
            </p>
          )}
        </div>

        {/* === Instagram 피드 섹션 === */}
        {gallery.instagramConnected && (
          <div>
            <h2 className="text-xl font-medium mb-3 flex items-center gap-2">
              <Instagram size={18} className="text-gray-500" />
              Instagram
            </h2>
            {gallery.instagramFeedVisible ? (
              <InstagramFeed galleryId={Number(id)} instagramUrl={gallery.instagramUrl} />
            ) : (
              <InstagramPrivateMessage isOwner={isOwner} />
            )}
          </div>
        )}

        {/* === 진행중인 공모 섹션 === */}
        {gallery.exhibitions && gallery.exhibitions.length > 0 && (
          <div>
            <h2 className="text-xl font-medium mb-3">진행중인 모집공고</h2>
            <div className="space-y-3">
              {gallery.exhibitions
                .filter(e => getDday(e.deadline) >= 0) // D-day가 남은 공고만 표시
                .map(ex => (
                  <div
                    key={ex.id}
                    onClick={() => navigate(`/exhibitions/${ex.id}`)}
                    className="p-4 border border-gray-100 rounded-xl hover:bg-gray-50 cursor-pointer"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium">{ex.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {exhibitionTypeLabels[ex.type]} · 모집 {ex.capacity}명 · {regionLabels[ex.region]}
                        </p>
                        <p className="text-sm text-gray-500">
                          전시일: {new Date(ex.exhibitDate).toLocaleDateString('ko')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-none">
                        <span className="text-sm font-bold text-red-500 flex items-center gap-1">
                          <Clock size={14} /> D-{getDday(ex.deadline)}
                        </span>
                        {(isOwner || isAdmin) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm('이 공모를 삭제하시겠습니까?')) {
                                deleteExhibitionMutation.mutate(ex.id);
                              }
                            }}
                            className="p-1 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* === 종료된 전시 - 홍보 사진 섹션 === */}
        {gallery.exhibitions && gallery.exhibitions.filter(e => new Date(e.exhibitDate) < new Date()).length > 0 && (
          <div>
            <h2 className="text-xl font-medium mb-3">종료된 전시</h2>
            <div className="space-y-4">
              {gallery.exhibitions
                .filter(e => new Date(e.exhibitDate) < new Date())
                .map(ex => (
                  <div key={ex.id} className="p-4 border border-gray-100 rounded-xl">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-medium">{ex.title}</h3>
                        <p className="text-sm text-gray-500">
                          {exhibitionTypeLabels[ex.type]} · 전시일: {new Date(ex.exhibitDate).toLocaleDateString('ko')}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">종료</span>
                    </div>

                    {/* 홍보 사진 그리드 (모든 유저에게 표시) */}
                    {ex.promoPhotos && ex.promoPhotos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        {ex.promoPhotos.map((photo: PromoPhoto, photoIdx: number) => (
                          <div key={photo.id} className="relative group">
                            <img
                              src={photo.url}
                              alt={photo.caption || '홍보 사진'}
                              className="w-full h-24 object-cover rounded-lg cursor-pointer"
                              onClick={() => setLightbox({
                                images: ex.promoPhotos!.map((p: PromoPhoto) => p.url),
                                index: photoIdx,
                              })}
                            />
                            {photo.caption && (
                              <p className="text-xs text-gray-500 mt-1 truncate">{photo.caption}</p>
                            )}
                            {/* 오너만 삭제 버튼 표시 */}
                            {isOwner && (
                              <button
                                onClick={() => deletePromoPhotoMutation.mutate({ exhibitionId: ex.id, photoId: photo.id })}
                                className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 오너 전용: 홍보 사진 추가 버튼 및 업로드 폼 */}
                    {isOwner && (
                      <>
                        {promoExhibitionId === ex.id ? (
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
                            <ImageUpload
                              value={promoUrl}
                              onChange={(url: string) => setPromoUrl(url)}
                              onRemove={() => setPromoUrl('')}
                              placeholder="홍보 사진 업로드"
                            />
                            <input
                              type="text"
                              value={promoCaption}
                              onChange={e => setPromoCaption(e.target.value)}
                              placeholder="사진 설명 (선택)"
                              className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  if (!promoUrl.trim()) { toast.error('사진을 업로드해주세요.'); return; }
                                  promoPhotoMutation.mutate({ exhibitionId: ex.id, url: promoUrl, caption: promoCaption });
                                }}
                                disabled={promoPhotoMutation.isPending}
                                className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                              >
                                등록
                              </button>
                              <button
                                onClick={() => { setPromoExhibitionId(null); setPromoUrl(''); setPromoCaption(''); }}
                                className="px-3 py-1.5 text-sm text-gray-500"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPromoExhibitionId(ex.id)}
                            className="mt-3 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-900"
                          >
                            <Camera size={14} /> 홍보 사진 추가
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* === 리뷰 섹션 === */}
        <div>
          <h2 className="text-xl font-medium mb-3">리뷰</h2>

          {/* 리뷰 작성 폼 (Artist 전용) */}
          {isArtist && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <p className="text-sm font-medium mb-2">리뷰 작성</p>
              {/* 별점 선택 (1~5) */}
              <div className="flex gap-1 mb-3">
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setReviewRating(s)}>
                    <Star
                      size={20}
                      className={s <= reviewRating ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300'}
                    />
                  </button>
                ))}
              </div>
              {/* 리뷰 텍스트 */}
              <textarea
                value={reviewContent}
                onChange={e => setReviewContent(e.target.value)}
                placeholder="리뷰를 작성해주세요"
                className="w-full h-20 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              {/* 리뷰 이미지 (선택) */}
              <ImageUpload
                value={reviewImageUrl}
                onChange={(url) => setReviewImageUrl(url)}
                onRemove={() => setReviewImageUrl('')}
                placeholder="사진 첨부 (선택)"
                className="mt-2"
              />
              {/* 익명 체크박스 + 등록 버튼 */}
              <div className="flex justify-between items-center mt-2">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={reviewAnonymous}
                    onChange={e => setReviewAnonymous(e.target.checked)}
                    className="rounded"
                  />
                  익명으로 작성
                </label>
                <button
                  onClick={() => {
                    if (!reviewContent.trim()) { toast.error('리뷰 내용을 입력해주세요.'); return; }
                    reviewMutation.mutate({
                      galleryId: Number(id),
                      rating: reviewRating,
                      content: reviewContent,
                      anonymous: reviewAnonymous,
                      imageUrl: reviewImageUrl || undefined,
                    });
                  }}
                  disabled={reviewMutation.isPending}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                >
                  등록
                </button>
              </div>
            </div>
          )}

          {/* 리뷰 목록 */}
          {gallery.reviews?.length === 0 ? (
            <p className="text-gray-400 text-center py-8">아직 리뷰가 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {gallery.reviews?.map(review => {
                const isMyReview = review.userId === user?.id;
                const isEditing = editingReviewId === review.id;

                return (
                  <div key={review.id} className="p-4 border border-gray-100 rounded-xl">
                    {isEditing ? (
                      // 수정 모드
                      <div className="space-y-3">
                        <p className="text-sm font-medium">리뷰 수정</p>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map(s => (
                            <button key={s} onClick={() => setReviewRating(s)}>
                              <Star size={18} className={s <= reviewRating ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300'} />
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={reviewContent}
                          onChange={e => setReviewContent(e.target.value)}
                          className="w-full h-20 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400"
                        />
                        <ImageUpload value={reviewImageUrl} onChange={(url) => setReviewImageUrl(url)} onRemove={() => setReviewImageUrl('')} placeholder="사진 첨부 (선택)" />
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" checked={reviewAnonymous} onChange={e => setReviewAnonymous(e.target.checked)} className="rounded" />
                          익명으로 작성
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (!reviewContent.trim()) { toast.error('리뷰 내용을 입력해주세요.'); return; }
                              updateReviewMutation.mutate({
                                reviewId: review.id,
                                rating: reviewRating,
                                content: reviewContent,
                                anonymous: reviewAnonymous,
                                imageUrl: reviewImageUrl || undefined,
                              });
                            }}
                            disabled={updateReviewMutation.isPending}
                            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                          >
                            수정 완료
                          </button>
                          <button
                            onClick={() => { setEditingReviewId(null); setReviewContent(''); setReviewRating(5); setReviewAnonymous(false); setReviewImageUrl(''); }}
                            className="px-4 py-2 text-sm text-gray-500"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      // 보기 모드
                      <>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-sm">{getReviewerName(review)}</p>
                            <div className="flex gap-0.5 mt-1">
                              {[1, 2, 3, 4, 5].map(s => (
                                <Star key={s} size={12} className={s <= review.rating ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-200'} />
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">
                              {new Date(review.createdAt).toLocaleDateString('ko')}
                            </span>
                            {/* 작성자: 수정/삭제 버튼 */}
                            {isMyReview && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingReviewId(review.id);
                                    setReviewRating(review.rating);
                                    setReviewContent(review.content);
                                    setReviewAnonymous(review.anonymous);
                                    setReviewImageUrl(review.imageUrl || '');
                                  }}
                                  className="p-1 text-gray-400 hover:text-gray-900"
                                  title="수정"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  onClick={() => {
                                    if (window.confirm('이 리뷰를 삭제하시겠습니까?')) {
                                      deleteReviewMutation.mutate(review.id);
                                    }
                                  }}
                                  className="p-1 text-gray-400 hover:text-red-500"
                                  title="삭제"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                            {/* Admin 삭제 버튼 (본인 리뷰가 아닌 경우만) */}
                            {isAdmin && !isMyReview && (
                              <button
                                onClick={() => deleteReviewMutation.mutate(review.id)}
                                className="p-1 text-red-400 hover:text-red-600"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 mt-2">{review.content}</p>
                        {review.imageUrl && (
                          <img
                            src={review.imageUrl}
                            alt=""
                            className="mt-2 h-32 rounded-lg object-cover cursor-pointer"
                            onClick={() => setLightbox({ images: [review.imageUrl!], index: 0 })}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* === 갤러리 삭제 버튼 (오너 또는 Admin) === */}
      {(isOwner || isAdmin) && (
        <div className="px-4 mt-8">
          <button
            onClick={() => {
              if (window.confirm('정말로 이 갤러리를 삭제하시겠습니까? 관련된 모든 공모, 리뷰, 이미지가 함께 삭제됩니다.'))
                deleteGalleryMutation.mutate();
            }}
            disabled={deleteGalleryMutation.isPending}
            className="w-full py-3 border-2 border-red-400 text-red-500 rounded-xl font-semibold hover:bg-red-50 transition disabled:opacity-50"
          >
            {deleteGalleryMutation.isPending ? '삭제 중...' : '갤러리 삭제'}
          </button>
        </div>
      )}

      {/* 이미지 확대 Lightbox (AnimatePresence로 exit 애니메이션 지원) */}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// =============================================
// 갤러리 이미지 캐러셀 (scroll-snap 기반, 자체 state)
// =============================================
interface CarouselProps {
  images: string[];
  galleryName: string;
  imgIndex: number;
  setImgIndex: (i: number) => void;
  onImageClick: (index: number) => void;
  isFavorited: boolean;
  showFavorite: boolean;
  onFavoriteClick: () => void;
}

function GalleryImageCarousel({
  images, galleryName, imgIndex, setImgIndex, onImageClick,
  isFavorited, showFavorite, onFavoriteClick,
}: CarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  // 내부 인덱스 ref — 리렌더 없이 자동슬라이드/observer에서 참조
  const currentRef = useRef(imgIndex);
  const dragState = useRef({ isDragging: false, startX: 0, scrollLeft: 0, didDrag: false });

  // 외부 imgIndex 변경 시 ref 동기화
  useEffect(() => { currentRef.current = imgIndex; }, [imgIndex]);

  // 특정 슬라이드로 스크롤
  const scrollToSlide = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    isScrolling.current = true;
    container.scrollTo({ left: index * container.offsetWidth, behavior: 'smooth' });
    currentRef.current = index;
    setImgIndex(index);
    setTimeout(() => { isScrolling.current = false; }, 400);
  }, [setImgIndex]);

  // IntersectionObserver로 현재 슬라이드 감지 (setState 최소화)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || images.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrolling.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!isNaN(index) && index !== currentRef.current) {
              currentRef.current = index;
              setImgIndex(index);
            }
          }
        }
      },
      { root: container, threshold: 0.5 }
    );

    const children = container.querySelectorAll('[data-index]');
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [images.length, setImgIndex]);

  // 3초 자동 슬라이드 — ref 기반으로 deps 최소화 (리렌더 방지)
  useEffect(() => {
    if (images.length <= 1) return;
    const timer = setInterval(() => {
      const next = (currentRef.current + 1) % images.length;
      scrollToSlide(next);
    }, 5000);
    return () => clearInterval(timer);
  }, [images.length, scrollToSlide]);

  // 마우스 드래그 핸들러 (데스크톱)
  const handleMouseDown = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    dragState.current = { isDragging: true, startX: e.pageX - container.offsetLeft, scrollLeft: container.scrollLeft, didDrag: false };
    container.style.cursor = 'grabbing';
    container.style.scrollSnapType = 'none';
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current.isDragging) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const x = e.pageX - container.offsetLeft;
    const walk = x - dragState.current.startX;
    if (Math.abs(walk) > 5) dragState.current.didDrag = true;
    container.scrollLeft = dragState.current.scrollLeft - walk;
  };
  const handleMouseUp = () => {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = '';
    container.style.scrollSnapType = 'x mandatory';
  };
  const handleMouseLeave = () => {
    if (dragState.current.isDragging) handleMouseUp();
  };

  // 슬라이드 클릭 (드래그가 아닌 경우만 lightbox 열기)
  const handleSlideClick = (index: number) => {
    if (!dragState.current.didDrag) onImageClick(index);
  };

  return (
    <div className="relative w-full h-72 md:h-[28rem] bg-black overflow-hidden">
      {/* scroll-snap 컨테이너 — GPU 가속, 터치 이벤트 직접 전달 */}
      <div
        ref={containerRef}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-grab select-none"
        style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {images.map((src, i) => (
          <div
            key={`${src}-${i}`}
            data-index={i}
            className="relative w-full h-full flex-shrink-0 snap-start"
            style={{ willChange: 'transform' }}
            onClick={() => handleSlideClick(i)}
          >
            <img
              src={src}
              alt={`${galleryName} ${i + 1}`}
              className="w-full h-full object-cover"
              draggable={false}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>

      {/* 찜하기 버튼 */}
      {showFavorite && (
        <button
          onClick={(e) => { e.stopPropagation(); onFavoriteClick(); }}
          className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur rounded-full shadow z-10"
        >
          <Heart size={22} className={isFavorited ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-400'} />
        </button>
      )}

      {/* 좌우 화살표 */}
      {images.length > 1 && (
        <>
          <button
            onClick={() => scrollToSlide((imgIndex - 1 + images.length) % images.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 rounded-full z-10"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => scrollToSlide((imgIndex + 1) % images.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 rounded-full z-10"
          >
            <ChevronRight size={20} />
          </button>
          {/* 인디케이터 점 */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToSlide(i)}
                className={`w-2 h-2 rounded-full transition-all ${i === imgIndex ? 'bg-white w-5' : 'bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// =============================================
// 오너 전용: 갤러리 이미지 관리 패널
// =============================================
interface ImageManagerProps {
  galleryId: number;
  galleryImages: { id: number; url: string; order: number }[];
  onImgIndexGuard: (maxIndex: number) => void;
}

function GalleryImageManager({ galleryId, galleryImages, onImgIndexGuard }: ImageManagerProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 이미지 삭제 후 imgIndex 범위 초과 방지
  useEffect(() => {
    onImgIndexGuard(Math.max(0, galleryImages.length - 1));
  }, [galleryImages.length, onImgIndexGuard]);

  // 이미지 추가 mutation (기존 POST /api/galleries/:id/images 사용)
  const addImageMutation = useMutation({
    mutationFn: (url: string) =>
      api.post(`/galleries/${galleryId}/images`, { url, order: galleryImages.length }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', String(galleryId)] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('이미지가 추가되었습니다.');
    },
    onError: () => toast.error('이미지 추가에 실패했습니다.'),
  });

  // 이미지 삭제 mutation
  const deleteImageMutation = useMutation({
    mutationFn: (imageId: number) =>
      api.delete(`/galleries/${galleryId}/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', String(galleryId)] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('이미지가 삭제되었습니다.');
    },
    onError: () => toast.error('이미지 삭제에 실패했습니다.'),
  });

  // 파일 업로드 → 이미지 추가
  const MAX_IMAGES = 20;

  const handleUpload = async (files: FileList) => {
    const remaining = MAX_IMAGES - galleryImages.length;
    if (remaining <= 0) {
      toast.error(`이미지는 최대 ${MAX_IMAGES}장까지 등록 가능합니다.`);
      return;
    }
    const fileArray = Array.from(files).slice(0, remaining);
    setUploading(true);
    let count = 0;
    for (const file of fileArray) {
      try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await api.post('/upload/image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        await addImageMutation.mutateAsync(res.data.url);
        count++;
      } catch {
        toast.error(`${file.name} 업로드 실패`);
      }
    }
    if (count > 0 && files.length > 1) toast.success(`${count}장 업로드 완료`);
    setUploading(false);
  };

  return (
    <div className="px-4 pt-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <Camera size={14} />
        사진 관리
        <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {galleryImages.map((img) => (
              <div key={img.id} className="relative group">
                <img src={img.url} alt="" className="w-full h-20 object-cover rounded-lg" />
                <button
                  onClick={() => {
                    if (window.confirm('이 사진을 삭제하시겠습니까?')) {
                      deleteImageMutation.mutate(img.id);
                    }
                  }}
                  className="absolute top-1 right-1 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {/* 추가 버튼 (최대 20장) */}
            {galleryImages.length < MAX_IMAGES && (
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-gray-400 transition-colors"
              >
                {uploading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <Plus size={18} />
                    <span className="text-xs mt-0.5">{galleryImages.length}/{MAX_IMAGES}</span>
                  </>
                )}
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) handleUpload(files);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
