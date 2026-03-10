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
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Star, ChevronLeft, ChevronRight, MapPin, Phone, Clock, Trash2, Image, Camera, X, Edit3, Instagram, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import ImageUpload from '@/components/shared/ImageUpload';
import ImageLightbox from '@/components/shared/ImageLightbox';
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto pb-12">
      {/* === 이미지 슬라이더 === */}
      <div className="relative w-full h-64 md:h-96 bg-gray-100">
        <img
          src={images[imgIndex]}
          alt={gallery.name}
          className="w-full h-full object-cover cursor-pointer"
          onClick={() => setLightbox({ images, index: imgIndex })}
        />

        {/* 찜하기 버튼 (우상단, Admin 제외) */}
        {isAuthenticated && !isAdmin && (
          <button
            onClick={() => favMutation.mutate()}
            className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur rounded-full shadow"
          >
            <Heart size={22} className={gallery.isFavorited ? 'text-red-500 fill-red-500' : 'text-gray-400'} />
          </button>
        )}

        {/* 이미지 좌우 네비게이션 화살표 (2장 이상일 때만 표시) */}
        {images.length > 1 && (
          <>
            <button
              onClick={() => setImgIndex((imgIndex - 1 + images.length) % images.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 rounded-full"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => setImgIndex((imgIndex + 1) % images.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 rounded-full"
            >
              <ChevronRight size={20} />
            </button>
            {/* 인디케이터 점 */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_, i) => (
                <span key={i} className={`w-2 h-2 rounded-full ${i === imgIndex ? 'bg-white' : 'bg-white/50'}`} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="px-4 py-6 space-y-8">
        {/* === 기본 정보 섹션 === */}
        <div>
          <h1 className="text-2xl font-bold">{gallery.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Star size={16} className="text-yellow-400 fill-yellow-400" />
            <span className="font-medium">{gallery.rating.toFixed(1)}</span>
            <span className="text-gray-400 text-sm">({gallery.reviewCount}개 리뷰)</span>
          </div>
          <p className="text-gray-600 mt-2 flex items-center gap-1"><MapPin size={14} /> {gallery.address}</p>
          {/* 모바일: tel: 링크로 다이얼러 연결, 데스크톱: 일반 텍스트 */}
          <a href={`tel:${gallery.phone}`} className="text-gray-600 flex items-center gap-1 md:hidden active:text-blue-600">
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
              className="text-pink-500 hover:text-pink-600 flex items-center gap-1"
            >
              <Instagram size={14} /> {gallery.instagramUrl}
            </a>
          )}
          <p className="text-gray-700 mt-2">{gallery.description}</p>
        </div>

        {/* === 상세 소개 섹션 === */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-bold">상세 소개</h2>
            {/* 갤러리 오너만 수정 버튼 표시 */}
            {isOwner && !isEditingDetail && (
              <button
                onClick={() => { setDetailDesc(gallery.detailDesc || ''); setIsEditingDetail(true); }}
                className="text-sm text-blue-500 hover:text-blue-600"
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
                className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        {/* === 진행중인 공모 섹션 === */}
        {gallery.exhibitions && gallery.exhibitions.length > 0 && (
          <div>
            <h2 className="text-lg font-bold mb-3">진행중인 모집공고</h2>
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
            <h2 className="text-lg font-bold mb-3">종료된 전시</h2>
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
                              className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="mt-3 flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600"
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
          <h2 className="text-lg font-bold mb-3">리뷰</h2>

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
                      className={s <= reviewRating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
                    />
                  </button>
                ))}
              </div>
              {/* 리뷰 텍스트 */}
              <textarea
                value={reviewContent}
                onChange={e => setReviewContent(e.target.value)}
                placeholder="리뷰를 작성해주세요"
                className="w-full h-20 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                              <Star size={18} className={s <= reviewRating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'} />
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={reviewContent}
                          onChange={e => setReviewContent(e.target.value)}
                          className="w-full h-20 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                <Star key={s} size={12} className={s <= review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />
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
                                  className="p-1 text-gray-400 hover:text-blue-500"
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
