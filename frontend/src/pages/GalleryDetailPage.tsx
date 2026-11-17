/**
 * GalleryDetailPage - 갤러리 상세 페이지
 *
 * 기능:
 *  - 상단 이미지 슬라이더 (좌우 화살표 네비게이션)
 *  - 우상단 찜하기(하트) 버튼
 *  - 갤러리 기본정보: 이름, 주소, 리뷰 개수, 한줄소개
 *    ⚠️ **별점은 2026-09-10 에 없앴다** — 리뷰 글은 그대로 두고 점수만 뺐다(서버도 안 받는다).
 *  - 상세소개: 갤러리 오너만 수정 버튼 표시
 *  - 진행중인 공모 목록 (D-day 표시)
 *  - 리뷰 섹션:
 *    - Artist 전용 리뷰 작성 폼 (텍스트, 사진 옵션, 익명 체크박스)
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
import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, ChevronLeft, ChevronRight, MapPin, Phone, Trash2, Camera, X, Edit3, Instagram, Plus, Loader2, Share2, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { artistPath, galleryPath } from '@/lib/handle';
import { resolveHomepageTheme, themeCssVars, themeVarStyle } from '@/lib/homepageTheme';
import { GALLERY_OPEN_HOURS_MAX, instagramHref, monthDayKst } from '@/lib/homepageSite';
import { HOMEPAGE_PANEL_MIN_H, liftToHomepageTabs } from '@/lib/siteMode';
import { shareLink } from '@/lib/shareLink';
import SiteHeader from '@/components/homepage/SiteHeader';
import SiteFooter from '@/components/homepage/SiteFooter';
import NewsTab from '@/components/homepage/NewsTab';
import InquirySheet from '@/components/homepage/InquirySheet';
import { LinkAction, TabActions } from '@/components/homepage/Actions';
import FollowButton from '@/components/shared/FollowButton';
import Thumb from '@/components/shared/Thumb';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, REGION_CODES, exhibitionTypeLabels, displayName, compressImage, MAX_IMAGE_BYTES, canFavorite, capacityText } from '@/lib/utils';
import AddressField from '@/components/form/AddressField';
import { addressCheck, deadlineView, isOpenCall } from '@/lib/listings';
import GalleryVisitInfo from '@/components/homepage/GalleryVisitInfo';
import ImageUpload, { MultiImageUpload } from '@/components/shared/ImageUpload';
import SquarePhotoGrid from '@/components/shared/SquarePhotoGrid';
import PageTabBar from '@/components/shared/PageTabBar';
import RichText from '@/components/shared/RichText';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import { galleryTabs, resolveGalleryTab, galleryTabParam, type GalleryTabId } from '@/lib/galleryTabs';
import ImageLightbox from '@/components/shared/ImageLightbox';
import SkeletonImage from '@/components/shared/SkeletonImage';
import ViewCountBadge from '@/components/shared/ViewCountBadge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import HostBadge from '@/components/shared/HostBadge';
import GalleryArchiveRow from '@/components/gallery/GalleryArchiveRow';
import GalleryArchiveForm from '@/components/gallery/GalleryArchiveForm';
import { emptyArchiveDraft, draftFrom, type ArchiveDraft } from '@/lib/galleryArchive';
import { canDelete } from '@/lib/exhibitionHost';
import type { Gallery, Review, Exhibition, PromoPhoto } from '@/types';

// 갤러리 상세 응답 타입 (기본 Gallery + 연관 데이터)
type GalleryDetail = Gallery & {
  exhibitions: Exhibition[];
  reviews: Review[];
  owner: { id: number };
};

/**
 * 갤러리 홈페이지 v2 (2026-09-16) — 작가 홈페이지와 같은 위계.
 * 사진 전폭(둥근 모서리·글로우 없음) → 이름 마스트헤드 → **탭**(2026-09-27, `lib/galleryTabs.ts`):
 * 소개 · 모집 중(포스터 카드) · 함께한 작가 · 지난 전시(아트페어·기록 포함) · 리뷰.
 * 비어 있는 탭은 방문자에게 만들지 않는다(주인에게만 채우라고 보인다). 예전엔 이 다섯이 한 페이지에 세로로 이어졌다.
 */

/** 갤러리 홈페이지는 꾸미기(색·글꼴)가 없다 — 사이트 기본 톤의 변수만 얹어 머리·꼬리말·버튼이 작가 홈페이지와 같은 부품을 쓴다 */
const SITE_THEME = resolveHomepageTheme(null);

/** 홍보 사진을 한 번에 올릴 수 있는 장수 — 한 번에 너무 많이 고르면 업로드가 길어져 중간에 창을 닫기 쉽다 */
const PROMO_BATCH_MAX = 20;

export default function GalleryDetailPage({ galleryId }: { galleryId?: number } = {}) {
  const params = useParams<{ id: string }>();
  // 들어오는 길이 둘이다: `/galleries/:id`(숫자) 와 `/@handle`(App.tsx 의 `HandleRoute` 가 주인을 알아내 id 로 넘긴다).
  const id = galleryId != null ? String(galleryId) : params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  // 이미지 슬라이더 인덱스
  const [imgIndex, setImgIndex] = useState(0);

  // 한줄소개 수정 상태
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descText, setDescText] = useState('');

  // 상세소개 수정 상태
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [detailDesc, setDetailDesc] = useState('');

  // 연락처(전화번호·주소) 수정 상태 — 갤러리 오너가 승인 없이 즉시 수정
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [contactAddress, setContactAddress] = useState('');
  /** 상세 주소(층·호수) — 주소 검색으로 고른 도로명 주소 뒤에 붙여 한 줄로 저장한다(components/form/AddressField) */
  const [contactAddressDetail, setContactAddressDetail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRegion, setContactRegion] = useState('SEOUL');
  const [contactInstagram, setContactInstagram] = useState('');
  // 홈페이지 주소(/@handle) — 연락처와 함께 저장한다(따로 버튼을 두면 저장한 줄 모른다)
  const [contactHandle, setContactHandle] = useState('');
  const [handleMsg, setHandleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 관람 시간 · 비회원 문의 받기(2026-11-14) — 연락처와 함께 저장한다
  const [contactOpenHours, setContactOpenHours] = useState('');
  const [contactGuestInquiry, setContactGuestInquiry] = useState(false);
  // [문의하기] 창(회원은 ArtTalk, 비회원은 갤러리가 켰으면 이름·연락처)
  const [inquiryOpen, setInquiryOpen] = useState(false);

  // 홍보 사진 업로드 폼 상태 (전시 종료 후, 갤러리 오너 전용)
  const [promoExhibitionId, setPromoExhibitionId] = useState<number | null>(null);
  // 홍보 사진은 여러 장을 한 번에 올리고 사진마다 설명을 붙인다(2026-09-27) — 예전엔 한 장씩 [등록]을 눌러야 했다
  const [promoDrafts, setPromoDrafts] = useState<{ url: string; caption: string }[]>([]);
  const [deletePromo, setDeletePromo] = useState<{ exhibitionId: number; photoId: number } | null>(null);

  // 이미지 확대 Lightbox 상태
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  // 리뷰 작성/수정 폼 상태
  const [reviewContent, setReviewContent] = useState('');
  const [reviewAnonymous, setReviewAnonymous] = useState(false);
  const [reviewImageUrl, setReviewImageUrl] = useState('');
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);

  // 리뷰 공모 선택 + 확인 다이얼로그 상태
  const [selectedExhibitionId, setSelectedExhibitionId] = useState<number | null>(null);
  const [reviewConfirmOpen, setReviewConfirmOpen] = useState(false);

  /** 탭 막대 바로 위 표지 — 막대가 상단에 붙은 채 탭을 바꾸면 새 내용의 첫머리로 올려 준다(작가 홈페이지와 같다) */
  const tabAnchorRef = useRef<HTMLDivElement>(null);
  /*
    탭을 누르면 **그 탭 내용으로 내려간다** — 탭 줄이 사이트 머리 밑에 붙고 그 아래가 고른 탭(2026-11-15 사용자 지적, lib/siteMode.ts).
    새 내용을 그린 뒤(useLayoutEffect)에 옮긴다. 탭은 주소(`?tab=`)에 있으므로 그 값이 바뀐 뒤다.
    ⚠️ 이 훅은 로딩·없음 분기(early return) **위**에 있어야 한다(hooksBeforeReturn.test.ts).
  */
  const liftPending = useRef(false);
  const rawTabParam = new URLSearchParams(location.search).get('tab');
  useLayoutEffect(() => {
    if (!liftPending.current) return;
    liftPending.current = false;
    liftToHomepageTabs('gallery-tabs');
  }, [rawTabParam]);

  // 지난 활동 기록(아트링크 밖 전시·아트페어) 작성/수정 상태 — null 이면 폼이 닫힌 것
  const [archiveDraft, setArchiveDraft] = useState<ArchiveDraft | null>(null);
  const [archiveEditId, setArchiveEditId] = useState<number | null>(null);
  const [deleteArchiveId, setDeleteArchiveId] = useState<number | null>(null);

  // ConfirmDialog 상태
  const [deleteExConfirmId, setDeleteExConfirmId] = useState<number | null>(null);
  const [deleteReviewConfirmId, setDeleteReviewConfirmId] = useState<number | null>(null);

  // 갤러리 상세 조회
  const { data: gallery, isLoading } = useQuery<GalleryDetail>({
    queryKey: ['gallery', id],
    queryFn: () => api.get(`/galleries/${id}`).then(r => r.data),
    enabled: !!id,
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
  });

  // 리뷰 작성 가능한 공모 목록 (Artist 전용)
  const isArtistUser = isAuthenticated && user?.role === 'ARTIST';
  const { data: reviewableExhibitions = [] } = useQuery<{ id: number; title: string }[]>({
    queryKey: ['reviewable-exhibitions', id],
    queryFn: () => api.get(`/reviews/reviewable/${id}`).then(r => r.data),
    enabled: isArtistUser,
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

  // 연락처(전화번호·주소) 수정 (갤러리 오너 전용, 승인 불필요)
  const contactMutation = useMutation({
    /*
      연락처와 홈페이지 주소를 **함께** 저장한다 — 버튼이 둘이면 하나만 누르고 나가서 "저장했는데 안 바뀐다"가 된다.
      주소는 별도 라우트(`PUT /galleries/:id/handle`)라 순서대로 부른다. 주소가 409(중복)면 그 이유를 화면에 남기고
      **연락처 저장은 그대로 끝낸다** — 주소 하나 때문에 주소·전화번호 수정이 통째로 날아가면 안 된다.
    */
    mutationFn: async (payload: { address: string; phone: string; region: string; instagramUrl: string; handle: string; openHours: string; guestInquiry: boolean }) => {
      const { handle, ...detail } = payload;
      await api.patch(`/galleries/${id}/detail`, detail);
      const current = gallery?.handle ?? '';
      if (handle && handle !== current) {
        try {
          await api.put(`/galleries/${id}/handle`, { handle });
        } catch (e: any) {
          return { handleError: e?.response?.data?.error || '홈페이지 주소를 저장하지 못했습니다.' };
        }
      }
      return {};
    },
    onSuccess: (res: { handleError?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      if (res.handleError) {
        setHandleMsg({ ok: false, text: res.handleError });
        toast.error(res.handleError);
        return; // 폼을 열어 둔다 — 주소를 고쳐 다시 저장할 수 있게
      }
      setIsEditingContact(false);
      setHandleMsg(null);
      toast.success('갤러리 정보가 수정되었습니다.');
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
    mutationFn: (data: { galleryId: number; exhibitionId: number; content: string; anonymous: boolean; imageUrl?: string }) =>
      api.post('/reviews', data),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      queryClient.invalidateQueries({ queryKey: ['reviewable-exhibitions', id] });
      // 폼 초기화
      setReviewContent('');
      setReviewAnonymous(false);
      setReviewImageUrl('');
      setSelectedExhibitionId(null);
      toast.success('리뷰가 등록되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '리뷰 작성에 실패했습니다.'),
  });

  // 리뷰 수정 (작성자 본인)
  const updateReviewMutation = useMutation({
    mutationFn: (data: { reviewId: number; content: string; anonymous: boolean; imageUrl?: string }) =>
      api.patch(`/reviews/${data.reviewId}`, { content: data.content, anonymous: data.anonymous, imageUrl: data.imageUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
      setEditingReviewId(null);
      setReviewContent('');
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

  // 홍보 사진 등록 (Gallery 오너 전용, 전시 종료 후) — 고른 사진을 차례로 올린다. 중간에 실패해도 앞의 것은 남는다
  const promoPhotoMutation = useMutation({
    mutationFn: async ({ exhibitionId, photos }: { exhibitionId: number; photos: { url: string; caption: string }[] }) => {
      let saved = 0;
      try {
        for (const p of photos) {
          await api.post(`/exhibitions/${exhibitionId}/promo-photos`, { url: p.url, caption: p.caption.trim() || undefined });
          saved++;
        }
      } catch (e) {
        throw Object.assign(new Error('partial'), { saved, cause: e });
      }
      return saved;
    },
    onSuccess: (saved) => {
      setPromoExhibitionId(null);
      setPromoDrafts([]);
      toast.success(`사진 ${saved}장을 등록했습니다.`);
    },
    onError: (e: Error) => {
      // 앞에서 올라간 사진은 화면 목록에서 빼 둔다 — 다시 [등록]을 눌러도 같은 사진이 두 번 올라가지 않게
      const saved = (e as Error & { saved?: number }).saved ?? 0;
      if (saved) setPromoDrafts((prev) => prev.slice(saved));
      toast.error(saved ? `${saved}장까지 등록하고 나머지는 실패했습니다. 다시 눌러 주세요.` : '사진 등록에 실패했습니다.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['gallery', id] }),
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

  /*
    정식 주소로 바꿔 준다 (2026-09-16) — 작가 페이지와 같은 규칙. 숫자 주소로 들어왔는데 핸들이 있으면
    `/@handle` 로 갈아끼운다. 앱 안의 갤러리 링크를 전부 고치는 것보다 이게 확실하다(목록·전시·알림 등 여럿).
  */
  const canonical = gallery?.handle ? `/@${gallery.handle}` : null;
  useEffect(() => {
    if (!canonical || location.pathname === canonical) return;
    navigate({ pathname: canonical, search: location.search }, { replace: true });
  }, [canonical, location.pathname, location.search, navigate]);

  // 지난 활동 기록 저장 — id 가 있으면 수정, 없으면 새로 만든다(폼이 하나라 저장도 한 곳)
  const archiveMutation = useMutation({
    mutationFn: ({ id: archiveId, draft }: { id: number | null; draft: ArchiveDraft }) => {
      const body = {
        title: draft.title.trim(),
        venue: draft.venue.trim() || null,
        period: draft.period.trim() || null,
        date: draft.date || null,
        artists: draft.artists.trim() || null,
        body: draft.body.trim() || null,
        images: draft.images,
      };
      return archiveId
        ? api.patch(`/galleries/${id}/archives/${archiveId}`, body)
        : api.post(`/galleries/${id}/archives`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      setArchiveDraft(null);
      setArchiveEditId(null);
      toast.success('기록이 저장되었습니다.');
    },
    onError: () => toast.error('기록 저장에 실패했습니다.'),
  });

  const deleteArchiveMutation = useMutation({
    mutationFn: (archiveId: number) => api.delete(`/galleries/${id}/archives/${archiveId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', id] });
      setDeleteArchiveId(null);
      toast.success('기록이 삭제되었습니다.');
    },
    onError: () => toast.error('기록 삭제에 실패했습니다.'),
  });

  // 함께한 작가 숨기기/보이기 (갤러리 주인)
  const hideArtistMutation = useMutation({
    mutationFn: ({ artistId, hidden }: { artistId: number; hidden: boolean }) =>
      api.patch(`/galleries/${id}/artists/${artistId}`, { hidden }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gallery', id] }),
    onError: () => toast.error('변경에 실패했습니다.'),
  });

  // 로딩 스켈레톤
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <SiteHeader />
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
          <div className="h-64 bg-gray-100 animate-pulse mb-4" />
          <div className="h-8 bg-gray-100 rounded w-1/3 animate-pulse mb-2" />
          <div className="h-4 bg-gray-100 rounded w-2/3 animate-pulse" />
        </div>
      </div>
    );
  }
  if (!gallery) {
    return (
      <div className="min-h-screen bg-white">
      <SiteHeader />
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <h1 className="text-xl font-semibold text-gray-900">갤러리를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-gray-500">삭제되었거나 존재하지 않는 갤러리입니다.</p>
        <button onClick={() => navigate('/galleries')} className="mt-8 px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
          갤러리 목록으로
        </button>
      </div>
      </div>
    );
  }

  // 이미지 목록 구성 (images 배열 -> mainImage -> 빈 슬라이드(플레이스홀더))
  const images = gallery.images?.length > 0
    ? gallery.images.map(img => img.url)
    : [gallery.mainImage || ''];
  // 실제 이미지가 최소 1장 있는지 — 0장 갤러리에서 빈 라이트박스가 열리는 것 방지
  const hasImage = images.some((url) => !!url && url.trim() !== '');

  // 권한 체크
  const isOwner = user?.id === gallery.ownerId;
  const isAdmin = user?.role === 'ADMIN';
  const isArtist = user?.role === 'ARTIST';

  /*
    모집 중 = 모집공고 [모집 중] · 갤러리 목록 카드의 '모집 중' 과 **같은 규칙**(lib/listings.ts isOpenCall = 서버 openCallWhere, 2026-11-15).
    예전엔 마감일만 봐서 갤러리가 일찍 닫은(수동 마감·전시 종료) 공모도 여기 'D-n' 으로 남았고, 시작 전 공모도 마감일 기준 D-day 를 달았다.
    일찍 닫은 공모는 모집이 끝난 것이라 아래 '지난 전시·아트페어'로 간다. 시작 전 공모는 모집공고 목록처럼 시작일까지 나오지 않는다.
  */
  const openCalls = (gallery.exhibitions ?? []).filter((e) => isOpenCall(e));
  // 모집이 끝난 공모 전부(전시 중 포함) — 예전엔 마감일은 지났는데 전시일은 안 지난 공모가 어느 섹션에도 없었다(2026-09-19).
  // 공모만 진행한 공고(exhibitDate null)도 여기 — 전시 일자가 없다
  const pastCalls = (gallery.exhibitions ?? []).filter((e) => deadlineView(e).state === 'closed');
  const isOngoingCall = (e: { exhibitDate: string | null }) => !!e.exhibitDate && getDday(e.exhibitDate) >= 0;
  const artists = gallery.artists ?? [];
  const archives = gallery.archives ?? [];

  /*
    탭 (2026-09-27, 사용자 요청 "작가 홈페이지처럼") — 소개 · 모집 중 · 함께한 작가 · 지난 전시 · 리뷰.
    규칙은 `lib/galleryTabs.ts` 한 곳(작가 홈페이지 `homepageTabs` 와 같다). 주소 `?tab=`, 첫 탭은 쿼리 없음, replace.
    ⚠️ 숨긴 작가는 **주인·Admin 에게만** 내려온다(서버 canManage). 숨긴 작가만 남아도 관리자에겐 탭이 있어야 되돌릴 수 있다.
  */
  const canManageArtists = isOwner || isAdmin;
  const visibleArtists = artists.filter(a => !a.hidden);
  const hiddenArtists = artists.filter(a => a.hidden);
  const tabs = galleryTabs({
    hasAbout: !!gallery.detailDesc,
    openCallCount: openCalls.length,
    visibleArtistCount: visibleArtists.length,
    hiddenArtistCount: hiddenArtists.length,
    historyCount: pastCalls.length + archives.length,
    storyCount: gallery.storyCount ?? 0,
    highlightCount: gallery.highlightCount ?? 0,
    reviewCount: gallery.reviews?.length ?? 0,
    isOwner,
    canManageArtists,
  });
  const activeTab = resolveGalleryTab(new URLSearchParams(location.search).get('tab'), tabs);
  const selectTab = (tab: GalleryTabId) => {
    // 지금 탭을 또 눌러도 그 내용으로 내려간다(표지를 보다가 [소개]를 누른 사람)
    if (tab === activeTab) { liftToHomepageTabs('gallery-tabs'); return; }
    liftPending.current = true;
    const next = new URLSearchParams(location.search);
    const param = galleryTabParam(tab, tabs);
    if (param) next.set('tab', param); else next.delete('tab');
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  /** 함께한 작가 칸 하나 — 숨긴 작가는 그림만 흐리고 버튼은 또렷하게(예전엔 칸 전체가 opacity-40 이라 [다시 보이기]가 안 보였다) */
  const artistCard = (a: (typeof artists)[number]) => (
    <div key={a.id} className="group min-w-0">
      <Link to={artistPath(a)} className="block">
        <div className={`flex aspect-square items-center justify-center bg-gray-50 ${a.hidden ? 'opacity-40' : ''}`}>
          {a.cover ? (
            <Thumb src={a.cover.url} size="grid" alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : a.avatar ? (
            <img src={a.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl text-gray-300">{displayName(a).slice(0, 1)}</span>
          )}
        </div>
        <p className={`mt-2 truncate text-sm group-hover:underline underline-offset-4 ${a.hidden ? 'text-gray-400' : 'text-gray-900'}`}>{displayName(a)}</p>
      </Link>
      {canManageArtists && (
        a.hidden ? (
          <button
            onClick={() => hideArtistMutation.mutate({ artistId: a.id, hidden: false })}
            disabled={hideArtistMutation.isPending}
            className="mt-1.5 inline-flex min-h-[32px] items-center rounded-md border border-gray-300 px-2.5 text-xs text-gray-700 hover:border-gray-900 hover:text-gray-900 disabled:opacity-50"
          >
            다시 보이기
          </button>
        ) : (
          <button
            onClick={() => hideArtistMutation.mutate({ artistId: a.id, hidden: true })}
            disabled={hideArtistMutation.isPending}
            className="mt-1 min-h-[32px] text-xs text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline disabled:opacity-50"
          >
            숨기기
          </button>
        )
      )}
    </div>
  );

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
        return `${displayName(review.user)} (익명)`;
      }
      anonCounter++;
      return `익명의 예술가 ${anonCounter}`;
    }
    return displayName(review.user);
  };

  const homePath = galleryPath(gallery);
  const pageUrl = `${window.location.origin}${homePath}`;
  const share = async () => {
    if ((await shareLink(`${gallery.name} — ArtLink`, pageUrl)) === 'copied') toast.success('링크를 복사했습니다.');
  };
  // [문의하기] — 주인과 운영 계정에는 없다(운영 계정으로 영업 대화 금지 — 예전 [메시지]와 같은 규칙)
  const canInquire = !isOwner && !isAdmin;
  /* 버튼 묶음 — 탭 줄 오른쪽(2026-11-15, 작가 홈페이지와 같은 TabActions). 예전 [메시지]는 [문의하기]로 합쳤다 */
  const tabActions = (
    <TabActions onInquiry={canInquire ? () => setInquiryOpen(true) : null}>
      {!isOwner && <FollowButton userId={gallery.ownerId} variant="text" className="whitespace-nowrap text-[var(--hp-sub)] hover:text-[var(--hp-ink)]" />}
      {canFavorite(user) && (
        <LinkAction
          icon={Heart}
          iconClassName={gallery.isFavorited ? 'fill-accent text-accent' : ''}
          aria-pressed={!!gallery.isFavorited}
          onClick={() => favMutation.mutate()}
        >
          찜
        </LinkAction>
      )}
      <LinkAction icon={Share2} onClick={share}>공유</LinkAction>
    </TabActions>
  );
  const nowShow = gallery.nowShow ?? null;
  const openContactEdit = () => {
    setContactAddress(gallery.address); setContactAddressDetail(''); setContactPhone(gallery.phone); setContactRegion(gallery.region || 'SEOUL');
    setContactInstagram(gallery.instagramUrl || ''); setContactHandle(gallery.handle || ''); setHandleMsg(null);
    setContactOpenHours(gallery.openHours || ''); setContactGuestInquiry(!!gallery.guestInquiry);
    setIsEditingContact(true);
  };
  // 주소 점검 — 주소 검색(2026-11-15)이 생기기 전에 자유 글로 등록한 갤러리(lib/listings addressCheck)
  const addrCheck = addressCheck(gallery.address, gallery.region);
  const igUrl = instagramHref(gallery.instagramUrl);

  return (
    <div style={themeCssVars(SITE_THEME)} className="flex min-h-screen flex-col">
      {/* 사이트 머리(2026-11-14, 규칙 82) — ArtLink 상단바 대신 갤러리 이름. 탭은 표지 아래 탭 줄 하나(2026-11-15) */}
      <SiteHeader title={gallery.name} titleTo={homePath} />
    {/* 본문 — 이 페이지의 `<main>`(Layout 은 홈페이지에서 main 을 그리지 않는다, 규칙 82) */}
    <motion.main initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl w-full mx-auto flex-1 px-6 md:px-12 pb-12">
      {/*
        === 표지 (2026-11-14, 규칙 82) ===
        PC 두 칸 — 왼쪽 이름 · 한 줄 소개 · 버튼 줄 · 방문 정보 · 지금 전시 / 오른쪽 사진. 휴대폰은 사진 → 이름 → … 순.
        예전엔 사진이 전폭으로 서고 그 아래 이름·연락처가 흩어져 있어, 언제 열고 어디 있는지·지금 무슨 전시를 하는지가 첫 화면에 없었다.
        실제 갤러리 4곳 중 3곳이 사진 1장뿐이라, 그 상태에서도 첫 화면이 채워지는 것을 기준으로 잡았다(방문 정보가 왼쪽 칸을 채운다).
      */}
      <div className={`pt-6 md:pt-10 ${hasImage ? 'md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-x-12 lg:gap-x-16' : ''}`}>
        {hasImage && (
          <div className="min-w-0 md:order-2">
            <GalleryImageCarousel
              images={images}
              galleryName={gallery.name}
              imgIndex={imgIndex}
              setImgIndex={setImgIndex}
              onImageClick={(index) => { if (hasImage) setLightbox({ images, index }); }}
            />
          </div>
        )}

        <div className="min-w-0 pt-6 md:order-1 md:pt-0" data-testid="gallery-cover">
          {/* 지역 · 리뷰 개수 — 별점을 없앤 자리(2026-09-10). 조회수는 주인·관리자만 */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{regionLabels[gallery.region] ?? gallery.region}</span>
            <span className="text-gray-300">·</span>
            {gallery.reviewCount > 0 ? (
              <span className="text-gray-600">리뷰 {gallery.reviewCount}개</span>
            ) : (
              <span className="text-gray-400">아직 리뷰 없음</span>
            )}
            <ViewCountBadge count={gallery.viewCount} className="shrink-0" />
          </div>
          <h1 className="mt-3 min-w-0 text-4xl md:text-5xl font-semibold tracking-[-0.02em] leading-[1.05] break-keep [overflow-wrap:anywhere]">{gallery.name}</h1>

          {/* 한 줄 소개 — 주인은 그 자리에서 고친다 */}
          {isEditingDesc ? (
            <div className="mt-4 space-y-2">
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
            <div className="flex items-start gap-2 mt-4">
              <p className="max-w-3xl text-base md:text-lg leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere]">{gallery.description}</p>
              {isOwner && (
                <button
                  onClick={() => { setDescText(gallery.description || ''); setIsEditingDesc(true); }}
                  className="flex-none text-gray-400 hover:text-gray-900 mt-1"
                  title="한줄 소개 수정"
                  aria-label="수정"
                >
                  <Edit3 size={13} />
                </button>
              )}
            </div>
          )}

          {isEditingContact ? (
            /* 오너 전용: 연락처·관람 시간·홈페이지 주소·비회원 문의 즉시 수정 (승인 불필요) */
            <div className="mt-6 space-y-2 max-w-md" data-testid="gallery-contact-form">
              <label className="block">
                <span className="text-xs text-gray-500 flex items-center gap-1"><Clock size={12} /> 관람 시간 (선택)</span>
                <input
                  value={contactOpenHours}
                  onChange={(e) => setContactOpenHours(e.target.value)}
                  maxLength={GALLERY_OPEN_HOURS_MAX}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm"
                  placeholder="예: 화–일 11:00–18:00 · 월 휴관"
                />
              </label>
              {/* 주소 — [주소 검색](카카오 우편번호)으로 고르면 시·도·구가 정확해지고 지역 칸도 따라온다(2026-11-15). 직접 입력도 된다 */}
              <div>
                <span className="text-xs text-gray-500 flex items-center gap-1"><MapPin size={12} /> 주소</span>
                <div className="mt-1">
                  <AddressField
                    idPrefix="gallery-contact"
                    base={contactAddress}
                    detail={contactAddressDetail}
                    onChange={({ base, detail }) => { setContactAddress(base); setContactAddressDetail(detail); }}
                    onRegion={setContactRegion}
                  />
                </div>
              </div>
              <label className="block">
                <span className="text-xs text-gray-500 flex items-center gap-1"><MapPin size={12} /> 지역</span>
                <select
                  value={contactRegion}
                  onChange={(e) => setContactRegion(e.target.value)}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white"
                >
                  {REGION_CODES.map((r) => <option key={r} value={r}>{regionLabels[r]}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 flex items-center gap-1"><Phone size={12} /> 전화번호</span>
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm"
                  placeholder="예: 02-739-1212"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 flex items-center gap-1"><Instagram size={12} /> 인스타그램 주소 (선택)</span>
                <input
                  value={contactInstagram}
                  onChange={(e) => setContactInstagram(e.target.value)}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm"
                  placeholder="instagram.com/your_id 또는 @your_id"
                />
              </label>
              {/* 홈페이지 주소 `/@handle` (2026-09-16) — 작가와 같은 이름 공간이라 서버가 양쪽 중복을 함께 본다.
                  상호가 한글이라 자동 생성을 안 한다(로마자로 옮기면 엉뚱한 주소가 된다). 주인이 직접 정한다. */}
              <label className="block">
                <span className="text-xs text-gray-500">홈페이지 주소 (선택)</span>
                <span className="mt-1 flex items-stretch overflow-hidden rounded border border-gray-300 focus-within:ring-2 focus-within:ring-gray-400">
                  <span className="shrink-0 border-r border-gray-200 bg-gray-50 px-2.5 py-2 text-sm text-gray-500">artlink.cc/@</span>
                  <input
                    value={contactHandle}
                    onChange={(e) => { setContactHandle(e.target.value); setHandleMsg(null); }}
                    className="min-w-0 flex-1 px-3 py-2 text-sm focus:outline-none"
                    placeholder="gallery_m"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </span>
                <span className="mt-1 block text-[11px] text-gray-400">영문 소문자·숫자·마침표·밑줄, 3~30자. 비워 두면 `/galleries/{gallery.id}` 주소를 계속 씁니다.</span>
                {handleMsg && <span className={`mt-1 block text-xs ${handleMsg.ok ? 'text-green-600' : 'text-accent'}`}>{handleMsg.text}</span>}
              </label>
              {/* 비회원 문의(2026-11-14, 기본 꺼짐) — 켜면 로그인하지 않은 방문자도 [문의하기]로 이름·연락처를 남긴다. 받은 문의는 마이페이지 [받은 문의] */}
              <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 py-1">
                <input type="checkbox" checked={contactGuestInquiry} onChange={(e) => setContactGuestInquiry(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-gray-900" data-testid="gallery-guest-inquiry" />
                <span className="min-w-0 text-sm text-gray-800 break-keep">
                  로그인하지 않은 방문자의 문의도 받기
                  <Link to="/mypage?tab=received-inquiries" className="ml-2 text-xs text-gray-500 underline underline-offset-2">받은 문의 보기</Link>
                </span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const fullAddress = [contactAddress.trim(), contactAddressDetail.trim()].filter(Boolean).join(' ');
                    if (!fullAddress || !contactPhone.trim()) { toast.error('주소와 전화번호를 입력해주세요.'); return; }
                    contactMutation.mutate({
                      address: fullAddress, phone: contactPhone.trim(), region: contactRegion, instagramUrl: contactInstagram.trim(),
                      handle: contactHandle.trim().replace(/^@+/, '').toLowerCase(),
                      openHours: contactOpenHours.trim(), guestInquiry: contactGuestInquiry,
                    });
                  }}
                  disabled={contactMutation.isPending}
                  className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-50"
                >저장</button>
                <button onClick={() => setIsEditingContact(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
              </div>
            </div>
          ) : (
            /* 방문 정보 — 있는 것만(components/homepage/GalleryVisitInfo — 갤러리 등록 미리보기와 같은 부품).
               주소가 자유 글이라 시·도·구를 못 읽거나 지역 칸과 다르면 주인에게만 '주소 다시 넣기'(2026-11-15, 주소 검색이 생기기 전에 등록한 갤러리) */
            <GalleryVisitInfo
              openHours={gallery.openHours}
              address={gallery.address}
              phone={gallery.phone}
              email={gallery.email}
              instagramUrl={gallery.instagramUrl}
              addressNote={isOwner && addrCheck !== 'ok' && (
                <button type="button" onClick={openContactEdit} className="mt-1 block min-h-[32px] text-left text-[13px] text-accent underline underline-offset-4" data-testid="gallery-address-fix">
                  {addrCheck === 'mismatch' ? `주소와 지역(${regionLabels[gallery.region] ?? gallery.region})이 달라요 · 주소 다시 넣기` : '주소 검색으로 다시 넣기'}
                </button>
              )}
              owner={isOwner && (
                <>
                  <button onClick={openContactEdit} className="min-h-[32px] text-xs text-accent underline">정보 수정</button>
                  {!gallery.instagramUrl && <button onClick={openContactEdit} className="min-h-[32px] text-xs text-gray-500 hover:text-gray-900">인스타그램 주소 추가</button>}
                  {!gallery.openHours && <button onClick={openContactEdit} className="min-h-[32px] text-xs text-gray-500 hover:text-gray-900">관람 시간 추가</button>}
                </>
              )}
            />
          )}

          {/* 지금 전시 — 승인된 전시(Show) 가운데 진행 중(없으면 60일 안에 시작하는 것). 포스터는 자르지 않는다 */}
          {nowShow && (
            <Link to={`/shows/${nowShow.id}`} className="mt-7 flex max-w-md gap-4 border border-gray-200 p-3.5 hover:border-gray-900" data-testid="gallery-now-show">
              <span className="grid h-24 w-20 shrink-0 place-items-center bg-gray-50">
                <Thumb src={nowShow.posterImage} size="list" alt="" className="max-h-full max-w-full object-contain" />
              </span>
              <span className="flex min-w-0 flex-col justify-center">
                <span className="text-[12px] font-semibold text-accent">{nowShow.state === 'ongoing' ? '전시 중' : '전시 예정'}</span>
                <span className="mt-1 text-[15px] font-semibold leading-snug break-keep [overflow-wrap:anywhere]">{nowShow.title}</span>
                <span className="mt-1 text-[13px] text-gray-500">{monthDayKst(nowShow.startDate)} – {monthDayKst(nowShow.endDate)}</span>
              </span>
            </Link>
          )}
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

      <div className="pt-12 md:pt-16">
        {/* === 탭 (2026-09-27) — 표지 아래, 내리면 사이트 머리 아래에 붙는다(PC·휴대폰 모두 이 막대 하나 — 2026-11-15). 탭 이름이 곧 섹션 머리 === */}
        <div ref={tabAnchorRef} id="gallery-tabs">
        <PageTabBar tabs={tabs} active={activeTab} onSelect={selectTab} idPrefix="gallery" label="갤러리 메뉴" site trailing={tabActions} />
        <div role="tabpanel" id={`gallery-panel-${activeTab}`} aria-labelledby={`gallery-tab-${activeTab}`} className={`pt-8 md:pt-10 ${HOMEPAGE_PANEL_MIN_H}`}>

        {/* === 소개 — 비어 있으면 방문자에겐 탭이 없다("등록되지 않았습니다" 셋이 한 페이지에 있었다) === */}
        {activeTab === 'about' && (
        <div>
          {/* 갤러리 오너만 수정 버튼 표시 */}
          {isOwner && !isEditingDetail && (
            <div className="mb-4 flex justify-end">
              <button
                onClick={() => { setDetailDesc(gallery.detailDesc || ''); setIsEditingDetail(true); }}
                className="text-sm text-gray-400 hover:text-gray-900"
              >
                수정
              </button>
            </div>
          )}
          {isEditingDetail ? (
            <div className="max-w-3xl space-y-2">
              {/* 서식 있는 글(2026-09-28) — 제목·굵게·목록·링크 등. 옛 평범한 글은 문단으로 바뀌어 들어온다 */}
              <LazyRichTextEditor
                value={detailDesc}
                onChange={setDetailDesc}
                placeholder="공간의 성격, 주로 다루는 작업, 함께 일하고 싶은 작가에 대해 적어 주세요."
                maxLength={5000}
                minHeight={220}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => detailMutation.mutate(detailDesc)}
                  disabled={detailMutation.isPending}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
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
            gallery.detailDesc ? (
              <RichText value={gallery.detailDesc} className="max-w-3xl text-[15px] leading-[1.9] text-gray-700 break-keep [overflow-wrap:anywhere] text-justify" />
            ) : (
              <p className="max-w-3xl text-[15px] leading-[1.9] text-gray-400">
                소개를 적어 주세요 — 공간의 성격, 주로 다루는 작업, 함께 일하고 싶은 작가에 대해. 제목·굵게·목록·링크 같은 서식을 쓸 수 있습니다. 방문자에게는 비어 있는 동안 보이지 않습니다.
              </p>
            )
          )}
        </div>
        )}

        {/* === 모집 중 공모 — 목록 페이지와 같은 포스터 카드 === */}
        {activeTab === 'calls' && (
          <div>
            {/*
              ⚠️ **포스터를 크게 그리지 말 것** (2026-09-16 신고). 예전엔 `grid-cols-2 md:grid-cols-3` 이라
                 1280px 에서 카드 하나가 379×596px, 공모 4건에 섹션 높이가 1285px 이었다 — 갤러리 페이지가
                 포스터 벽이 됐다. 640~767px 구간은 2열이라 카드 하나가 화면을 거의 채웠다(사용자가 지적한 그 폭).
                 여기는 갤러리 소개지 공모 목록이 아니므로 **열을 늘려 카드를 작게** 잡는다(1280에서 5열 ≈ 220px).
              ⚠️ `object-cover` 도 쓰지 말 것 — 포스터는 제목이 인쇄된 **문서**다. A4 비율이 아닌 포스터는
                 좌우가 잘려 "나는 이제 그림에 투자한다!" 가 "는 이제" 로 보였다. `contain` + 옅은 바닥.
            */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-x-6">
              {openCalls.map(ex => {
                const dv = deadlineView(ex);
                return (
                  <article key={ex.id} className="group cursor-pointer" onClick={() => navigate(`/exhibitions/${ex.id}`)}>
                    <div className="flex aspect-[210/297] items-center justify-center overflow-hidden bg-gray-50">
                      <SkeletonImage
                        src={ex.imageUrl || ex.images?.[0]?.url || gallery.mainImage || ''}
                        alt={ex.title}
                        fallbackLabel={ex.title}
                        className="h-full w-full"
                        imgClassName="object-contain transition-opacity group-hover:opacity-80"
                        loading="lazy"
                      />
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium break-keep">{ex.title}</h3>
                          {/* 이 갤러리가 운영만 위임받은 공고 — 배지가 없으면 이 갤러리 주최로 오해한다 */}
                          <HostBadge exhibition={ex} />
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          {exhibitionTypeLabels[ex.type]} · 모집 {capacityText(ex)}{regionLabels[ex.region] ? ` · ${regionLabels[ex.region]}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className={`whitespace-nowrap text-sm font-semibold ${dv.hot ? 'text-accent' : 'text-gray-500'}`}>{dv.badge}</span>
                        {/* 아트링크 주최 공모는 주최자(Admin)만 삭제할 수 있다 — 서버도 403.
                            운영 여부는 이 페이지의 갤러리 오너인지로 정해진다(공모 응답에 ownerId가 없다) */}
                        {canDelete({ ...ex, canOperate: isOwner }, user) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteExConfirmId(ex.id); }}
                            className="p-1 text-gray-400 hover:text-accent"
                            aria-label="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* === 함께한 작가 — 이 갤러리 공모에 수락된 작가(서버 집계, 주인·Admin 은 숨길 수 있다) ===
            숨긴 작가는 방문자 목록에서 빠지고 관리자에게만 **아래 따로** 모인다(2026-09-27 신고 — 숨긴 뒤 되돌릴 자리를 못 찾았다). */}
        {activeTab === 'artists' && (
          <div>
            {visibleArtists.length > 0 ? (
              <div data-testid="gallery-artists" className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
                {visibleArtists.map(artistCard)}
              </div>
            ) : (
              <p className="text-sm text-gray-400">방문자에게 보이는 작가가 없습니다.</p>
            )}
            {canManageArtists && hiddenArtists.length > 0 && (
              <div data-testid="hidden-artists" className="mt-10 rounded-lg border border-dashed border-gray-300 p-4 md:p-5">
                <p className="text-sm font-medium text-gray-900">숨긴 작가 <span className="ml-1 font-normal text-gray-500">{hiddenArtists.length}</span></p>
                <p className="mt-0.5 text-xs text-gray-500">방문자에게는 보이지 않습니다. [다시 보이기]를 누르면 위 목록으로 돌아갑니다. 지원 기록은 그대로입니다.</p>
                <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
                  {hiddenArtists.map(artistCard)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* === 지난 전시·아트페어 ===
            아트링크에서 진행한 공모(홍보 사진 포함)와 **갤러리가 직접 적은 기록**(아트링크 밖의 전시·아트페어)을
            한 줄로 섞어 날짜순으로 보여 준다(2026-09-16). 보는 사람에겐 둘 다 "이 갤러리가 해 온 일"이라
            어디서 한 것인지 배지로 가르지 않는다. */}
        {activeTab === 'history' && (
          <div>
            <div className="mb-5 flex items-center justify-end gap-3 empty:hidden">
              {isOwner && !archiveDraft && (
                <button onClick={() => { setArchiveEditId(null); setArchiveDraft(emptyArchiveDraft()); }} className="text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900">
                  + 기록 추가
                </button>
              )}
            </div>

            {isOwner && archiveDraft && (
              <GalleryArchiveForm
                draft={archiveDraft}
                onChange={(update) => setArchiveDraft((prev) => (prev ? update(prev) : prev))}
                onSubmit={() => archiveMutation.mutate({ id: archiveEditId, draft: archiveDraft })}
                onCancel={() => { setArchiveDraft(null); setArchiveEditId(null); }}
                saving={archiveMutation.isPending}
              />
            )}

            {isOwner && pastCalls.length + archives.length === 0 && !archiveDraft && (
              <p className="py-4 text-sm text-gray-400">
                아트링크 밖에서 해 온 전시·아트페어도 여기에 적어 두면 갤러리 페이지에 남습니다. 방문자에게는 비어 있는 동안 보이지 않습니다.
              </p>
            )}

            <div className="space-y-4">
              {[
                ...archives.map((a) => ({
                  // 날짜가 없으면 등록 시각으로 — 그래도 섞이는 순서가 뒤죽박죽이 되진 않는다
                  sort: new Date(a.date || a.createdAt).getTime(),
                  node: (
                    <GalleryArchiveRow
                      key={`ar-${a.id}`}
                      archive={a}
                      canEdit={isOwner}
                      onEdit={() => { setArchiveEditId(a.id); setArchiveDraft(draftFrom(a)); }}
                      onDelete={() => setDeleteArchiveId(a.id)}
                      onOpenImage={(images, index) => setLightbox({ images, index })}
                    />
                  ),
                })),
                ...pastCalls.map(ex => ({
                  sort: new Date(ex.exhibitDate ?? ex.deadline).getTime(),
                  node: (
                  <div key={ex.id} className="py-4 border-b border-gray-200">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{ex.title}</h3>
                          <HostBadge exhibition={ex} />
                        </div>
                        <p className="text-sm text-gray-500">
                          {exhibitionTypeLabels[ex.type]} · {ex.exhibitDate ? `전시일: ${new Date(ex.exhibitDate).toLocaleDateString('ko')}` : `공모 마감: ${new Date(ex.deadline).toLocaleDateString('ko')}`}
                        </p>
                      </div>
                      {isOngoingCall(ex)
                        ? <span className="text-xs text-accent bg-accent/10 px-2 py-1 rounded">전시 중</span>
                        : <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">종료</span>}
                    </div>

                    {/* 홍보 사진 — 작가 홈페이지 작품 격자와 같은 정사각 칸(자르지 않는다). 모든 유저에게 표시 */}
                    {ex.promoPhotos && ex.promoPhotos.length > 0 && (
                      <SquarePhotoGrid
                        className="mt-4"
                        photos={ex.promoPhotos.map((photo: PromoPhoto) => ({ url: photo.url, caption: photo.caption, key: photo.id }))}
                        onOpen={(i) => setLightbox({ images: ex.promoPhotos!.map((p: PromoPhoto) => p.url), index: i })}
                        onRemove={isOwner ? (i) => setDeletePromo({ exhibitionId: ex.id, photoId: ex.promoPhotos![i].id }) : undefined}
                      />
                    )}

                    {/* 오너 전용: 홍보 사진 추가 버튼 및 업로드 폼 */}
                    {isOwner && (
                      <>
                        {promoExhibitionId === ex.id ? (
                          <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
                            <p className="text-xs text-gray-500">여러 장을 한 번에 골라도 됩니다. 사진마다 설명을 붙일 수 있어요(선택).</p>
                            <MultiImageUpload
                              images={promoDrafts}
                              onAdd={(url) => setPromoDrafts((prev) => [...prev, { url, caption: '' }].slice(0, PROMO_BATCH_MAX))}
                              onRemove={(i) => setPromoDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                              maxCount={PROMO_BATCH_MAX}
                              renderBelow={(i) => (
                                <input
                                  type="text"
                                  value={promoDrafts[i]?.caption ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value.slice(0, 100);
                                    setPromoDrafts((prev) => prev.map((p, idx) => (idx === i ? { ...p, caption: v } : p)));
                                  }}
                                  placeholder="사진 설명 (선택)"
                                  aria-label={`사진 ${i + 1} 설명`}
                                  className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-400"
                                />
                              )}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  if (promoDrafts.length === 0) { toast.error('사진을 올려주세요.'); return; }
                                  promoPhotoMutation.mutate({ exhibitionId: ex.id, photos: promoDrafts });
                                }}
                                disabled={promoPhotoMutation.isPending || promoDrafts.length === 0}
                                className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                              >
                                {promoPhotoMutation.isPending ? '등록 중…' : promoDrafts.length > 0 ? `${promoDrafts.length}장 등록` : '등록'}
                              </button>
                              <button
                                onClick={() => { setPromoExhibitionId(null); setPromoDrafts([]); }}
                                className="px-3 py-1.5 text-sm text-gray-500"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setPromoExhibitionId(ex.id); setPromoDrafts([]); }}
                            className="mt-3 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-900"
                          >
                            <Camera size={14} /> 홍보 사진 추가
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  ),
                })),
              ]
                .sort((a, b) => b.sort - a.sort)
                .map((it) => it.node)}
            </div>
          </div>
        )}

        {/* === 리뷰 — 탭은 늘 있다(작가가 쓰러 오는 곳, 방명록과 같다) === */}
        {/* === 소식 — 갤러리 주인 계정이 올린 ArtStory(2026-11-14, 규칙 82). 주인에겐 비어 있어도 탭이 있고 여기서 [소식 올리기] === */}
        {activeTab === 'news' && <NewsTab userId={gallery.ownerId} isOwner={isOwner} />}

        {activeTab === 'reviews' && (
        <div>

          {/* 리뷰 작성 폼 (Artist 전용) */}
          {isArtist && (
            <div className="mb-6 py-6 border-t border-b border-gray-200">
              <p className="text-sm font-medium mb-2">리뷰 작성</p>
              {reviewableExhibitions.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">수락된 공모가 없거나 이미 리뷰를 작성했습니다.</p>
              ) : (
                <>
                  {/* 공모 선택 드롭다운 */}
                  <div className="mb-3">
                    <label className="text-xs text-gray-500 mb-1 block">리뷰할 공모 선택</label>
                    <select
                      value={selectedExhibitionId ?? ''}
                      onChange={e => setSelectedExhibitionId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      <option value="">공모를 선택해주세요</option>
                      {reviewableExhibitions.map(ex => (
                        <option key={ex.id} value={ex.id}>{ex.title}</option>
                      ))}
                    </select>
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
                        if (!selectedExhibitionId) { toast.error('공모를 선택해주세요.'); return; }
                        if (!reviewContent.trim()) { toast.error('리뷰 내용을 입력해주세요.'); return; }
                        setReviewConfirmOpen(true);
                      }}
                      disabled={reviewMutation.isPending}
                      className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                    >
                      등록
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 리뷰 목록 */}
          {gallery.reviews?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">아직 리뷰가 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {gallery.reviews?.map(review => {
                const isMyReview = review.userId === user?.id;
                const isEditing = editingReviewId === review.id;

                return (
                  <div key={review.id} className="py-4 border-b border-gray-100">
                    {isEditing ? (
                      // 수정 모드
                      <div className="space-y-3">
                        <p className="text-sm font-medium">리뷰 수정</p>
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
                            onClick={() => { setEditingReviewId(null); setReviewContent(''); setReviewAnonymous(false); setReviewImageUrl(''); }}
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
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{getReviewerName(review)}</p>
                              {review.exhibition && (
                                <span className="text-xs text-gray-400">{review.exhibition.title}</span>
                              )}
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
                                    setReviewContent(review.content);
                                    setReviewAnonymous(review.anonymous);
                                    setReviewImageUrl(review.imageUrl || '');
                                  }}
                                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-900"
                                  title="수정"
                                  aria-label="수정"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  onClick={() => setDeleteReviewConfirmId(review.id)}
                                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-accent"
                                  aria-label="삭제"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                            {/* Admin 삭제 버튼 (본인 리뷰가 아닌 경우만) */}
                            {isAdmin && !isMyReview && (
                              <button
                                onClick={() => setDeleteReviewConfirmId(review.id)}
                                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-accent hover:text-accent"
                                aria-label="삭제"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">{review.content}</p>
                        {review.imageUrl && (
                          <img
                            src={review.imageUrl}
                            alt="리뷰 첨부 사진"
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
        )}

        </div>{/* tabpanel */}
        </div>{/* 탭 */}
      </div>

      {/* 갤러리 삭제는 마이페이지(내 갤러리)에서만 가능 — 상세 페이지에서는 제거 */}

      {/* ConfirmDialog 모음 */}
      <ConfirmDialog
        open={deleteExConfirmId !== null}
        title="공모 삭제"
        message="이 공모를 삭제하시겠습니까?"
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { deleteExhibitionMutation.mutate(deleteExConfirmId!); setDeleteExConfirmId(null); }}
        onCancel={() => setDeleteExConfirmId(null)}
      />
      <ConfirmDialog
        open={deleteReviewConfirmId !== null}
        title="리뷰 삭제"
        message="이 리뷰를 삭제하시겠습니까?"
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { deleteReviewMutation.mutate(deleteReviewConfirmId!); setDeleteReviewConfirmId(null); }}
        onCancel={() => setDeleteReviewConfirmId(null)}
      />
      <ConfirmDialog
        open={deleteArchiveId !== null}
        title="기록 삭제"
        message="이 기록을 삭제하시겠습니까? 사진과 글이 함께 지워집니다."
        variant="danger"
        confirmText="삭제"
        onConfirm={() => deleteArchiveMutation.mutate(deleteArchiveId!)}
        onCancel={() => setDeleteArchiveId(null)}
      />
      {/* 홍보 사진 삭제 — 서버가 파일까지 지워 되돌릴 수 없다. × 가 터치 기기에서 늘 보이므로 확인을 거친다 */}
      <ConfirmDialog
        open={deletePromo !== null}
        title="사진 삭제"
        message="이 사진을 삭제하시겠습니까? 되돌릴 수 없습니다."
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { if (deletePromo) deletePromoPhotoMutation.mutate(deletePromo); setDeletePromo(null); }}
        onCancel={() => setDeletePromo(null)}
      />
      <ConfirmDialog
        open={reviewConfirmOpen}
        title="리뷰 등록"
        message={`'${reviewableExhibitions.find(e => e.id === selectedExhibitionId)?.title || ''}' 공모에 대한 리뷰를 등록합니다. 공모당 1회만 작성 가능합니다.`}
        confirmText="등록"
        onConfirm={() => {
          setReviewConfirmOpen(false);
          reviewMutation.mutate({
            galleryId: Number(id),
            exhibitionId: selectedExhibitionId!,
            content: reviewContent,
            anonymous: reviewAnonymous,
            imageUrl: reviewImageUrl || undefined,
          });
        }}
        onCancel={() => setReviewConfirmOpen(false)}
      />

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
    </motion.main>
      {/* 꼬리말 — 갤러리의 연락처 · Made with ArtLink(2026-11-14, 규칙 82) */}
      <SiteFooter
        name={gallery.name}
        lines={[gallery.address, gallery.openHours || null, gallery.phone]}
        instagramUrl={igUrl}
        onInquiry={canInquire ? () => setInquiryOpen(true) : undefined}
      />
      {inquiryOpen && (
        <InquirySheet
          target={{ ownerId: gallery.ownerId, name: gallery.name, guestEnabled: gallery.guestInquiry === true, galleryId: gallery.id }}
          themeVars={themeVarStyle(SITE_THEME)}
          onClose={() => setInquiryOpen(false)}
        />
      )}
    </div>
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
}

/**
 * 갤러리 사진 — 표지 오른쪽 칸(휴대폰은 맨 위), 4:3 틀 안에 **자르지 않고**(contain) 남는 자리는 같은 사진을 흐리게(2026-11-14).
 * 예전엔 높이를 못박고 꽉 채워(cover) 포스터를 올린 갤러리의 사진 위아래가 잘렸다. 찜(하트)은 버튼 줄로 옮겼다.
 */
function GalleryImageCarousel({
  images, galleryName, imgIndex, setImgIndex, onImageClick,
}: CarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  // 내부 인덱스 ref — 리렌더 없이 자동슬라이드/observer에서 참조
  const currentRef = useRef(imgIndex);
  const isHovered = useRef(false);

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

  // 휠 가로채기 방지 — 캐러셀 위에서 휠을 굴리면 브라우저가 세로 휠을 가로 스크롤로
  // 변환해 이미지가 움직이는 문제를 막고, 세로 휠은 페이지 스크롤로 그대로 전달한다.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      // 가로 휠(트랙패드)은 캐러셀이 움직이지 않도록 무시
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        return;
      }
      // 세로 휠은 **브라우저에 맡긴다** — 직접 scrollBy 하면 Firefox(deltaMode=line, 3px)에서 거의 안 움직이고 Ctrl+휠 확대도 막혔다(2026-09-19).
      // 캐러셀은 overflow-x 만 스크롤이라 세로 휠을 삼키지 않는다.
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // 5초 자동 슬라이드 — hover 시 정지
  useEffect(() => {
    if (images.length <= 1) return;
    const timer = setInterval(() => {
      if (isHovered.current) return;
      const next = (currentRef.current + 1) % images.length;
      scrollToSlide(next);
    }, 5000);
    return () => clearInterval(timer);
  }, [images.length, scrollToSlide]);

  return (
    <div
      className="relative w-full aspect-[4/3] bg-gray-100 overflow-hidden"
      onMouseEnter={() => { isHovered.current = true; }}
      onMouseLeave={() => { isHovered.current = false; }}
    >
      {/* scroll-snap 컨테이너 — 데스크톱 마우스 드래그는 비활성화(화살표/점/모바일 스와이프로 이동),
          터치 스와이프는 네이티브 스크롤로 동작 */}
      <div
        ref={containerRef}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-pointer select-none"
        style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position' }}
      >
        {images.map((src, i) => (
          <div
            key={`${src}-${i}`}
            data-index={i}
            className="relative w-full h-full flex-shrink-0 snap-start"
            style={{ willChange: 'transform' }}
            onClick={() => onImageClick(i)}
          >
            {/* 자르지 않는다(contain) — 남는 자리는 같은 사진을 흐리게(blurFill) */}
            <SkeletonImage
              src={src}
              alt={`${galleryName} ${i + 1}`}
              fallbackLabel={galleryName}
              className="w-full h-full"
              imgClassName="object-contain"
              blurFill
              draggable={false}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>

      {/* 좌우 화살표 */}
      {images.length > 1 && (
        <>
          <button
            onClick={() => scrollToSlide((imgIndex - 1 + images.length) % images.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 rounded-full z-10"
            aria-label="이전 사진"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => scrollToSlide((imgIndex + 1) % images.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 rounded-full z-10"
            aria-label="다음 사진"
          >
            <ChevronRight size={20} />
          </button>
          {/* 인디케이터 점
              점 자체는 8px 이지만 그대로 두면 터치 영역이 8×8 이라 WCAG 2.2 AA(24×24)에 못 미치고
              손가락으로는 사실상 누를 수 없다. 보이는 크기는 유지한 채 버튼만 24×24 로 키운다.
              라벨이 없어 스크린리더가 빈 버튼으로 읽던 것도 함께 고친다. */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex z-10">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToSlide(i)}
                aria-label={`${i + 1}번째 사진 보기`}
                aria-current={i === imgIndex ? 'true' : undefined}
                className="flex h-6 w-6 items-center justify-center cursor-pointer"
              >
                <span className={`block h-2 rounded-full transition-all ${i === imgIndex ? 'bg-white w-5' : 'bg-white/50 w-2'}`} />
              </button>
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
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      handleUpload(dt.files);
    } else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };

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
    for (const rawFile of fileArray) {
      try {
        const file = await compressImage(rawFile);
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${rawFile.name}: 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
          continue;
        }
        const formData = new FormData();
        formData.append('image', file);
        const res = await api.post('/upload/image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        await addImageMutation.mutateAsync(res.data.url);
        count++;
      } catch {
        toast.error(`${rawFile.name} 업로드 실패`);
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
        aria-label="사진 관리"
      >
        <Camera size={14} />
        사진 관리
        <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`mt-3 p-3 bg-gray-50 rounded-lg ${dragOver ? 'ring-2 ring-gray-400' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={handleDrop}
        >
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {galleryImages.map((img) => (
              <div key={img.id} className="relative group">
                <img src={img.url} alt="갤러리 사진" className="w-full h-20 object-cover rounded-lg" />
                <button
                  onClick={() => {
                    if (window.confirm('이 사진을 삭제하시겠습니까?')) {
                      deleteImageMutation.mutate(img.id);
                    }
                  }}
                  className="absolute top-1 right-1 p-0.5 bg-accent text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="삭제"
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
                aria-label="사진 추가"
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
