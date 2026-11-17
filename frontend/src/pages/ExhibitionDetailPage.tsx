/**
 * ExhibitionDetailPage - 공모 상세 페이지
 *
 * 기능:
 *  - 전시 상세 정보 (제목, 갤러리, 타입, 날짜, 인원, 지역, D-day, 설명)
 *  - 상단 다중 사진 캐러셀 + 오너 인라인 사진 관리(추가/삭제(최소1장)/드래그 순서변경)
 *  - 홍보 사진 표시 (종료된 전시)
 *  - Artist: [지원하기] → 지원서 페이지(/exhibitions/:id/apply, 2026-09-29 — 예전엔 이 페이지 위 모달) + 찜
 *  - Gallery 오너: [지원자 보기] / [운영] → 마이페이지 [내 공모]의 그 카드로, 우측 하단 소형 삭제
 *
 * API:
 *  - GET /api/exhibitions/:id - 공모 상세 조회 (images 포함)
 *  - 지원(POST /api/exhibitions/:id/apply)은 `pages/ApplyPage.tsx`
 *  - POST|DELETE|PATCH /api/exhibitions/:id/images[...] - 사진 추가/삭제/순서변경
 *  - DELETE /api/exhibitions/:id - 공모 삭제
 *  - 지원자 관리는 마이페이지 '내 공모'의 인라인 ApplicantManager로 통합(별도 페이지 없음)
 *
 * @see /src/types/index.ts - Exhibition 타입
 * @see /src/stores/authStore.ts - 인증 상태
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Users, Send, Trash2, ArrowLeft, Heart, Edit3, X, ClipboardList, ChevronRight, Camera, Plus, GripVertical, Share2, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, REGION_CODES, exhibitionTypeLabels, compressImage, MAX_IMAGE_BYTES, canFavorite, cn, capacityText } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import InviteApplyModal from '@/components/shared/InviteApplyModal';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { DeleteRequestDialog, DeleteRequestLine } from '@/components/shared/DeleteRequest';
import { checkDeletable, useMyDeleteRequests } from '@/hooks/useDeleteRequests';
import JoinCodeInput from '@/components/shared/JoinCodeInput';
import SquarePhotoGrid from '@/components/shared/SquarePhotoGrid';
import RichText from '@/components/shared/RichText';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import ViewCountBadge from '@/components/shared/ViewCountBadge';
import { AttachmentEditor, AttachmentList } from '@/components/shared/ExhibitionAttachments';
import { normalizeAttachments, type ExhibitionAttachment } from '@/lib/attachments';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import HostBadge from '@/components/shared/HostBadge';
import { isAdminHosted, canOperate, canManage, canDelete, canChangeRegion, canEditTitle, EXHIBITION_TITLE_MAX } from '@/lib/exhibitionHost';
import { operatorWorkspace, galleryOperationHref } from '@/lib/operationLinks';
import type { Exhibition, PromoPhoto, ExhibitionImage } from '@/types';
import StatusChip from '@/components/flow/StatusChip';
import { applicationStatusView } from '@/lib/flowLabels';
import SkeletonImage from '@/components/shared/SkeletonImage';
import { ArtLinkWordmark } from '@/components/shared/HostBadge';
import { HeartButton } from '@/components/listing/ListControls';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { DETAIL_ACTION, DETAIL_LABEL } from '@/lib/detailStyles';
import { addressArea, deadlineView, scheduleSteps } from '@/lib/listings';
import { DeadlineText, DetailPoster, Fact, ScheduleStrip } from '@/components/exhibition/DetailBits';
import { shareLink } from '@/lib/shareLink';
import { galleryPath } from '@/lib/handle';



type ExhibitionDetail = Exhibition & {
  /**
   * ⚠️ **null 일 수 있다** — 아트링크가 갤러리를 안 끼고 직접 여는 공모(2026-09-10).
   *    예전엔 여기서 non-null 로 덮어써서, 전역 타입을 nullable 로 바꿔도 이 화면만
   *    타입 검사가 통과했다. 반드시 `gallery?.` 로 읽을 것.
   */
  gallery: {
    id: number;
    name: string;
    mainImage?: string;
    region: string;
    ownerId?: number;
    /** 주최 카드(2026-11-15) — 상세 응답은 갤러리 행을 통째로(마스킹해) 싣는다 */
    description?: string;
    address?: string;
    handle?: string | null;
    reviewCount?: number;
  } | null;
  promoPhotos?: PromoPhoto[];
  /** 이 공모에 초대받은 작가인지 (본인 기준) — 지원 버튼을 '간편 지원'으로 바꾼다 */
  invited?: boolean;
  /**
   * 마감 판정에 필요. **마감일과 별개다** — 마감일이 남았는데 갤러리가 수동으로 모집을 닫거나
   * 전시를 종료한 경우가 있다. 이걸 안 보면 그런 공고에 지원 버튼이 그대로 뜬다.
   */
  recruitmentClosed?: boolean;
  ended?: boolean;
  /**
   * 작가 자료제출 마감일. 2026-08-19 이전 공모에는 값이 없어(nullable) 운영자가 한 번 채운다.
   * 값이 없는 동안에는 아예 표시하지 않는다 — 없는 기한을 지어내면 안 된다.
   */
  submissionDeadline?: string | null;
};

export default function ExhibitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  // 소개 수정 상태
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  // 제목 고치기 — 아트링크 주최 공모의 관리자만(canEditTitle · 서버 PATCH /:id/title, 2026-10-26)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  // 이미지 확대 Lightbox 상태
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  // 초대받은 공모는 지원서 없이 포트폴리오로 지원(간편 지원). 초대 안 받은 작가는 지원서 페이지로.
  const [showInviteApply, setShowInviteApply] = useState(false);
  // 초대 코드 입력칸(접어 둔다) — 이미 선정된 작가용 보조 입구(2026-09-27)
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // 직접 지울 수 없을 때(수락한 작가 · 판매·정산 기록) — 관리자에게 삭제 요청. 이유는 서버가 준다(lib/deletion.ts)
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const deleteRequestOf = useMyDeleteRequests();
  // PC(1024px 이상)는 왼쪽 포스터 · 오른쪽 내용, 그 아래는 작은 포스터 + 한 줄기(A안). 둘을 CSS 로 함께 그리지 않는다
  const wide = useMediaQuery('(min-width: 1024px)');
  // 다른 모집공고 — 모집공고 목록과 **같은 캐시 키**(['exhibitions','open','']): 목록에서 왔으면 다시 받지 않는다
  const { data: openCalls = [] } = useQuery<Exhibition[]>({
    queryKey: ['exhibitions', 'open', ''],
    queryFn: () => api.get('/exhibitions').then((r) => r.data),
    staleTime: 60_000,
  });
  // 다른 공모로 넘어가면(같은 화면 · 주소만 바뀐다) 열려 있던 편집·창을 닫는다(렌더 중 상태 맞추기 — effect 안 setState 금지)
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setIsEditingDesc(false);
    setIsEditingTitle(false);
    setLightbox(null);
    setShowInviteApply(false);
    setShowCodeInput(false);
  }

  const { data: exhibition, isLoading } = useQuery<ExhibitionDetail>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
  });


  // 옛 로그인 복귀 주소(`?apply=1`) — 예전엔 지원 모달을 자동으로 열었다. 지금은 지원서 페이지로 보낸다.
  // 작가이고 마감 전이 아니면 파라미터만 지운다(새로고침 때 다시 걸리지 않게).
  useEffect(() => {
    if (!exhibition || searchParams.get('apply') !== '1') return;
    // 마감일뿐 아니라 수동 모집마감·전시종료·공모 시작 전도 봐야 한다 — 마감일이 남은 채 마감된 공고가 있다
    const open = getDday(exhibition.deadline) >= 0 && !exhibition.recruitmentClosed && !exhibition.ended
      && !(exhibition.deadlineStart && getDday(exhibition.deadlineStart) > 0);
    if (user?.role === 'ARTIST' && open && !exhibition.myApplication) { navigate(`/exhibitions/${id}/apply`, { replace: true }); return; }
    setSearchParams(
      (prev) => { const next = new URLSearchParams(prev); next.delete('apply'); return next; },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhibition, user, searchParams]);

  // 찜하기 토글 - 낙관적 업데이트로 즉시 반영
  const favMutation = useMutation({
    mutationFn: () => api.post('/favorites/toggle', { exhibitionId: parseInt(id!) }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['exhibition', id] });
      const prev = queryClient.getQueryData<ExhibitionDetail>(['exhibition', id]);
      if (prev) {
        queryClient.setQueryData(['exhibition', id], { ...prev, isFavorited: !prev.isFavorited });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['exhibition', id], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 삭제
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      toast.success('공모가 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      navigate('/exhibitions');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || '삭제 중 오류가 발생했습니다.');
    },
  });

  // 소개 수정 mutation (Gallery 오너 전용)
  const descMutation = useMutation({
    mutationFn: (desc: string) => api.patch(`/exhibitions/${id}/description`, { description: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      setIsEditingDesc(false);
      toast.success('공모 소개가 수정되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '수정에 실패했습니다.'),
  });

  const titleMutation = useMutation({
    mutationFn: (title: string) => api.patch(`/exhibitions/${id}/title`, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      queryClient.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setIsEditingTitle(false);
      toast.success('공모 제목을 바꿨어요.');
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error || '제목을 바꾸지 못했어요.'),
  });
  const saveTitle = () => {
    const t = editTitle.trim();
    if (!t) { toast.error('공모 제목을 입력해주세요.'); return; }
    titleMutation.mutate(t);
  };

  /* 갠톡 열기 — 이미 있으면 그 방으로 (서버가 판단).
     ⚠️ 예전에는 여기서 옛 쪽지 API(`POST /messages`)를 불렀는데, 대화가 ArtTalk 으로 바뀐 뒤로는
     그렇게 보낸 글을 **아무도 읽을 수 없었다**("전송되었습니다" 만 뜨고 어디에도 안 남는다). */
  const openChat = useMutation({
    mutationFn: (ownerId: number) => api.post('/chats/direct', { userId: ownerId }).then(r => r.data),
    onSuccess: (data: { id: number }) => navigate(`/messages?chat=${data.id}`),
    onError: (err: any) => toast.error(err.response?.data?.error || '대화를 열지 못했습니다.'),
  });

  const handleDelete = async () => {
    try {
      const blocked = await checkDeletable('exhibition', Number(id));
      if (blocked) setDeleteBlocked(blocked);
      else setDeleteConfirm(true);
    } catch (e: any) {
      toast.error(e.response?.data?.error || '삭제할 수 있는지 확인하지 못했어요.');
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
        <div className="h-48 bg-gray-100 animate-pulse mb-4" />
        <div className="h-8 bg-gray-100 rounded w-1/3 animate-pulse mb-2" />
        <div className="h-4 bg-gray-100 rounded w-2/3 animate-pulse" />
      </div>
    );
  }
  if (!exhibition) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <h1 className="text-xl font-semibold text-gray-900">공모를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-gray-500">삭제되었거나 마감된 공모일 수 있습니다.</p>
        <button onClick={() => navigate('/exhibitions')} className="mt-8 px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
          모집공고 목록으로
        </button>
      </div>
    );
  }

  const dday = getDday(exhibition.deadline);
  /**
   * '지원할 수 없음' 판정.
   *
   * 예전엔 마감일만 봤는데, 그러면 **마감일이 남은 채 수동 모집마감/전시종료된 공고**에
   * 지원 버튼이 그대로 떴다. 목록에서 안 보일 때는 드러나지 않다가,
   * [마감된 공고] 탭이 생기면서 실제로 도달 가능한 경로가 됐다.
   * 서버(`POST /:id/apply`)는 상태·수동마감·전시종료·마감일을 4중으로 막고 있으므로
   * 여기서 새도 지원이 되지는 않지만, 눌러보고 400 을 받는 화면은 만들지 않는다.
   */
  const isExpired = dday < 0 || !!exhibition.recruitmentClosed || !!exhibition.ended;
  /** 공모 시작일 전 — 주소로 들어오면 상세가 열린다(목록엔 안 나온다). 서버도 지원을 400 으로 막는다(2026-10-03 점검 P2) */
  const startDday = exhibition.deadlineStart ? getDday(exhibition.deadlineStart) : null;
  const notStarted = startDday !== null && startDday > 0;
  const isArtist = user?.role === 'ARTIST';
  const isAdmin = user?.role === 'ADMIN';
  // 아트링크 주최 공모는 위임받은 운영 갤러리도 오너와 같은 권한을 갖는다 (lib/exhibitionHost.ts)
  const isGalleryOwner = canOperate(exhibition, user);
  // 편집(소개·포스터·운영)은 Admin 도 된다 — 자기가 주최한 공고를 못 고치면 안 된다.
  // isGalleryOwner 는 '갤러리 계정인가'까지 보므로 편집 판정에 그대로 쓰면 Admin 이 빠진다.
  const canEdit = canManage(exhibition, user);
  const canDeleteExhibition = canDelete(exhibition, user);

  /*
    따라오는 [지원하기] 줄 — 무엇을 보여 줄지(2026-10-03). 지원할 수 있는 사람(아직 지원 안 한 작가 · 비로그인)에게만.
    공모 시작 전이면 버튼 없이 날짜만 — 서버가 지원을 막는다.
  */
  let applyBar: { note?: ReactNode; primary?: ReactNode; secondary?: ReactNode; sub?: ReactNode } | null = null;
  if (!isExpired && ((isArtist && !exhibition.myApplication) || !isAuthenticated)) {
    // 휴대폰에선 버튼이 줄을 채운다(한 줄) — 안내 글자와 함께 두 줄로 꺾이면 줄이 95px 가 되어 첫 화면을 크게 먹었다
    const primaryCls = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-6 text-sm font-medium text-white hover:bg-gray-800 sm:flex-none';
    if (notStarted) {
      const opens = new Date(exhibition.deadlineStart!).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
      applyBar = { note: <><b className="font-medium text-gray-900">{opens}부터 지원을 받아요.</b> 지금은 미리 보는 공고예요.</> };
    } else if (!isAuthenticated) {
      applyBar = {
        note: '작가 계정으로 로그인하면 지원할 수 있어요.',
        primary: (
          <button type="button" onClick={() => { setPostLoginRedirect(`/exhibitions/${id}/apply`); navigate('/login'); }} className={primaryCls}>
            <Send size={15} aria-hidden /> 로그인하고 지원하기
          </button>
        ),
        // 버튼 바로 아래 한 줄(2026-10-04 사용자 요청) — 광고로 처음 온 작가가 가입을 망설이지 않게.
        // ⚠️ 주어를 '아트링크'로 둘 것 — 공모마다 갤러리가 받는 참여비가 있어, '모든 서비스 무료'만 쓰면 그 공모가 무료라고 읽힌다
        sub: <>작가 회원은 아트링크의 모든 서비스를 <b className="font-semibold text-accent">무료</b>로 이용해요</>,
      };
    } else if (exhibition.invited) {
      applyBar = {
        note: '초대받은 공모예요. 지원서 없이 내 포트폴리오로 지원돼요.',
        secondary: (
          <button type="button" onClick={() => navigate(`/exhibitions/${id}/apply`)} className="min-h-[44px] text-sm text-gray-500 underline underline-offset-4 hover:text-gray-900">
            지원서 직접 쓰기
          </button>
        ),
        primary: (
          <button type="button" onClick={() => setShowInviteApply(true)} className={primaryCls}>
            <Send size={15} aria-hidden /> 간편 지원
          </button>
        ),
      };
    } else {
      // 안내 문구 없이 버튼만(2026-10-03 사용자 요청 — '홈페이지에 적은 약력·작품으로 지원서가 미리 채워져요' 삭제)
      applyBar = {
        primary: (
          <button type="button" onClick={() => navigate(`/exhibitions/${id}/apply`)} className={primaryCls}>
            <Send size={15} aria-hidden /> 지원하기
          </button>
        ),
      };
    }
  }

  // 상단 캐러셀에 표시할 사진 목록 (다중 → imageUrl → 갤러리 대표 순 폴백)
  const heroImages: string[] = (exhibition.images && exhibition.images.length > 0)
    ? exhibition.images.map((img) => img.url)
    : (exhibition.imageUrl ? [exhibition.imageUrl] : (exhibition.gallery?.mainImage ? [exhibition.gallery.mainImage] : []));

  // ─── 2026-11-15 개편: PC 는 왼쪽 포스터 · 오른쪽 내용, 휴대폰은 작은 포스터 옆에 마감·제목(A안 — 사용자 결정) ───
  const dv = deadlineView(exhibition);
  const steps = scheduleSteps(exhibition);
  const others = openCalls.filter((e) => e.id !== exhibition.id).slice(0, 3);   // 서버가 마감 가까운 순으로 준다
  const host = exhibition.gallery;
  const adminHosted = isAdminHosted(exhibition);
  // 갤러리에 문의 — 갤러리 주최 공모만(아트링크 주최는 특정 갤러리를 대표로 세우지 않는다). 작가만(갠톡 길목, 규칙 32)
  const canAsk = isArtist && !adminHosted && !!host?.ownerId;
  const goBack = () => { if ((window.history.state?.idx ?? 0) > 0) navigate(-1); else navigate('/exhibitions'); };   // 공유 링크로 왔으면 뒤가 사이트 밖이다
  const onShare = async () => {
    const r = await shareLink(exhibition.title, `${window.location.origin}/exhibitions/${exhibition.id}`);
    if (r === 'copied') toast.success('주소를 복사했어요');
  };
  const openPoster = (index: number) => { if (heroImages.length) setLightbox({ images: heroImages, index }); };

  const askButton = canAsk && (
    <button type="button" onClick={() => openChat.mutate(host!.ownerId!)} disabled={openChat.isPending} className={DETAIL_ACTION}>
      <MessageCircle size={16} aria-hidden /> 갤러리에 문의
    </button>
  );

  const headInfo = (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-3">
        <DeadlineText dv={dv} className="text-[13px] text-gray-600 lg:text-[15px]" />
        {/* 조회수는 서버가 공모를 올린 갤러리·관리자에게만 싣는다(백엔드 canSeeExhibitionViews) — 값이 왔으면 그린다 */}
        <ViewCountBadge count={exhibition.viewCount} owner className="shrink-0" />
      </div>
      <HostBadge exhibition={exhibition} className="mt-2 block lg:mt-3" />
      {isEditingTitle ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveTitle(); }
              else if (e.key === 'Escape') setIsEditingTitle(false);
            }}
            maxLength={EXHIBITION_TITLE_MAX}
            aria-label="공모 제목"
            autoFocus
            className="min-w-0 flex-1 basis-64 rounded-lg border border-gray-300 px-3 py-2 text-xl focus:border-gray-900 focus:outline-none"
          />
          <button onClick={saveTitle} disabled={titleMutation.isPending} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">저장</button>
          <button onClick={() => setIsEditingTitle(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
        </div>
      ) : (
        <div className="mt-1.5 lg:mt-2">
          <h1 className="text-[20px] font-semibold leading-snug tracking-tight text-gray-900 break-keep [overflow-wrap:anywhere] lg:text-[32px] lg:leading-tight">
            {exhibition.title}
          </h1>
          {canEditTitle(exhibition, user) && (
            <button
              onClick={() => { setEditTitle(exhibition.title); setIsEditingTitle(true); }}
              className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
              aria-label="제목 수정"
            >
              <Edit3 size={14} aria-hidden /> 수정
            </button>
          )}
        </div>
      )}
      {adminHosted ? (
        /* 아트링크 주최 — 갤러리들은 함께 운영할 뿐이라 대표로 세우지 않는다. 갤러리를 하나도 안 낀 공모는 다른 말을 쓴다
           (빈 '참여 갤러리 :' 만 남으면 데이터가 빠진 것처럼 보인다, 2026-09-10) */
        (exhibition.managerGalleries ?? []).length > 0 ? (
          <p className="mt-2 text-sm text-gray-600 lg:text-[15px]">
            참여 갤러리 :{' '}
            {(exhibition.managerGalleries ?? []).map((g, i) => (
              <span key={g.id}>
                {i > 0 && ', '}
                <Link to={`/galleries/${g.id}`} className="text-gray-900 underline-offset-4 hover:underline">{g.name}</Link>
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600 lg:text-[15px]">아트링크가 직접 진행합니다.</p>
        )
      ) : host && (
        <p className="mt-2 text-sm text-gray-600 lg:mt-3 lg:text-[15px]">
          <Link to={galleryPath(host)} className="font-medium text-gray-900 underline-offset-4 hover:underline">{host.name}</Link>
          <span className="ml-2">{[addressArea(host.address, host.region), (host.reviewCount ?? 0) > 0 ? `리뷰 ${host.reviewCount}개` : ''].filter(Boolean).join(' · ')}</span>
        </p>
      )}
    </div>
  );

  return (
    <div className="pb-4">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        {/* 목록으로 — 휴대폰은 같은 줄 오른쪽에 찜·공유 */}
        <div className="flex items-center justify-between pt-1 lg:pt-6">
          <Link
            to="/exhibitions"
            onClick={(e) => { if ((window.history.state?.idx ?? 0) > 0) { e.preventDefault(); goBack(); } }}
            className="-ml-1 inline-flex min-h-[48px] items-center gap-1.5 pr-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} aria-hidden /> 모집공고
          </Link>
          {!wide && (
            <div className="-mr-3 flex">
              {canFavorite(user) && <HeartButton on={!!exhibition.isFavorited} onToggle={() => favMutation.mutate()} size={20} />}
              <button type="button" onClick={onShare} aria-label="공유" className="grid h-11 w-11 place-items-center text-gray-700">
                <Share2 size={19} aria-hidden />
              </button>
            </div>
          )}
        </div>

        <div className={wide ? 'mt-3 grid grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-14 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)] xl:gap-20' : undefined}>
          {/* PC — 포스터는 원본 비율 그대로 세로로(여러 장이면 차례로). 한 장이고 고칠 사람이 아니면 내리는 동안 따라온다 */}
          {wide && (
            <aside className={cn('min-w-0', heroImages.length <= 1 && !canEdit && 'sticky top-28 self-start')}>
              {heroImages.length === 0 ? (
                <div className="grid aspect-[210/297] place-items-center bg-gray-100 px-3 text-center text-xs text-gray-500">{exhibition.title}</div>
              ) : (
                <div className="space-y-4">
                  {heroImages.map((src, i) => (
                    <DetailPoster key={`${src}-${i}`} src={src} alt={`${exhibition.title} 포스터 ${i + 1}`} eager={i === 0} onOpen={() => openPoster(i)} />
                  ))}
                </div>
              )}
              {/* 운영 갤러리 / Admin: 포스터 관리 (추가 / 삭제(최소 1장) / 드래그 순서변경) */}
              {canEdit && exhibition.images && <ExhibitionImageManager exhibitionId={exhibition.id} images={exhibition.images} />}
            </aside>
          )}

          <div className="min-w-0 lg:max-w-[720px]">
            {wide ? headInfo : (
              <div className="mt-1 flex gap-4">
                {/* 휴대폰 — 포스터는 작게, 누르면 크게(라이트박스). 첫 화면에 무슨 공모인지·언제 마감인지가 들어온다 */}
                <button type="button" onClick={() => openPoster(0)} disabled={!heroImages.length} aria-label="포스터 크게 보기" className="relative w-[104px] shrink-0 cursor-zoom-in self-start">
                  <SkeletonImage src={heroImages[0] ?? ''} thumb="grid" alt="" fallbackLabel={exhibition.title} className="aspect-[210/297]" imgClassName="object-contain" blurFill />
                  {heroImages.length > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 bg-gray-900/75 px-1.5 py-0.5 text-[11px] tabular-nums text-white">1 / {heroImages.length}</span>
                  )}
                </button>
                {headInfo}
              </div>
            )}

            {/* PC — 찜 · 공유 · 갤러리에 문의(글자 단추 한 벌). [지원하기]는 화면 아래 따라오는 줄 하나뿐이다 */}
            {wide && (
              <div className="mt-5 flex flex-wrap items-center gap-x-6">
                {canFavorite(user) && (
                  <button type="button" onClick={() => favMutation.mutate()} aria-label={exhibition.isFavorited ? '찜 해제' : '찜하기'} className={DETAIL_ACTION}>
                    <Heart size={16} aria-hidden className={exhibition.isFavorited ? 'fill-accent text-accent' : ''} /> 찜
                  </button>
                )}
                <button type="button" onClick={onShare} className={DETAIL_ACTION}>
                  <Share2 size={16} aria-hidden /> 공유
                </button>
                {askButton}
              </div>
            )}

            {/* 이미 지원한 작가 — [지원하기] 대신 상태를 보여 준다(2026-09-27). 예전엔 버튼이 그대로라 다 쓰고 나서 400 을 받았다 */}
            {isArtist && exhibition.myApplication && (() => {
              const st = exhibition.myApplication.status;
              const view = applicationStatusView(st, 'artist');
              const head = st === 'ACCEPTED' ? '선정되었어요' : st === 'REJECTED' ? '이번 공모에서는 선정되지 않았어요' : '지원 완료';
              const sub = st === 'ACCEPTED'
                ? (exhibition.recruitOnly ? '이 공모는 선정까지 진행해요.' : '내 전시에서 출품 자료 제출·전시·정산을 이어서 진행하세요.')
                : st === 'REJECTED' ? '다음 공모에서 다시 만나요.' : '갤러리가 검토하고 있어요. 결과는 알림으로 알려 드려요.';
              return (
                <div className="mt-6 rounded-lg border border-gray-200 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip variant={view.variant}>{view.label}</StatusChip>
                    <p className="text-sm font-semibold text-gray-900">{head}</p>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{sub}</p>
                  <button
                    onClick={() => navigate(`/mypage?tab=applications&ex=${exhibition.id}`)}
                    className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    내 전시에서 보기
                  </button>
                </div>
              );
            })()}

            {/* Gallery 오너: 지원자·운영은 마이페이지 [내 공모]의 **이 공모 카드**에서 — 그 카드를 펼친 채로 보낸다(예전엔 목록 맨 위로만 갔다) */}
            {isGalleryOwner && (
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate(operatorWorkspace(user?.role, exhibition.hostType, id)?.applicantsHref ?? '/mypage')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800"
                >
                  <Users size={16} aria-hidden /> 지원자 보기
                </button>
                <button
                  onClick={() => navigate(galleryOperationHref(id!))}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-300 px-5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  <ClipboardList size={16} aria-hidden /> 운영 · 출품 자료 · 정산
                </button>
              </div>
            )}

            {/* Admin(갤러리 계정이 아닌 운영자) — 마이페이지에 [내 공모]가 없어 운영 화면으로 */}
            {canEdit && !isGalleryOwner && (
              <button
                onClick={() => navigate(`/exhibitions/${id}/operation/new`)}
                className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-300 px-5 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                <ClipboardList size={16} aria-hidden /> 운영 페이지
              </button>
            )}

            {/* 로그인했지만 작가 계정이 아닌 경우(갤러리·관리자 제외) — 지원 불가 안내 */}
            {isAuthenticated && !isArtist && !isGalleryOwner && !isAdmin && !isExpired && (
              <p className="mt-5 text-sm text-gray-500">작가 계정만 지원할 수 있습니다.</p>
            )}

            {/* 일정 — 접수 시작 → 접수 마감 → 출품 자료 제출 → 전시. 다음 단계만 진하게(7일 안 마감이면 강조색), 지난 단계는 흐리게 */}
            <section aria-labelledby="ex-schedule" className="mt-8 lg:mt-10">
              <h2 id="ex-schedule" className={DETAIL_LABEL}>일정</h2>
              <div className="mt-3"><ScheduleStrip steps={steps} /></div>
              {/* 출품 자료 제출 마감일이 없는 옛 공모 — 운영자에게만 [입력] (없는 기한을 지어내지 않는다) */}
              <SubmissionDeadlineRow exhibition={exhibition} canEdit={canEdit} isAdmin={isAdmin} />
            </section>

            {/* 모집 내용 — 한 줄 표. 지역은 올린 뒤에도 바꿀 수 있다(갤러리 주최 = 그 갤러리, 아트링크 주최 = 관리자) */}
            <section aria-labelledby="ex-facts" className="mt-8">
              <h2 id="ex-facts" className={DETAIL_LABEL}>모집 내용</h2>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 border-b border-gray-100 sm:grid-cols-4">
                <Fact label="유형">{exhibitionTypeLabels[exhibition.type]}</Fact>
                <Fact label="모집 인원">{capacityText(exhibition)}</Fact>
                <RegionRow exhibition={exhibition} canChange={canChangeRegion(exhibition, user)} />
                {exhibition.recruitOnly && <Fact label="진행">공모만 진행</Fact>}
              </dl>
              {/* 공모만 진행하는 공고는 지원자에게 미리 알린다 — 수락 뒤에 아무 안내가 없으면 작가는 자료제출·정산을 기다리게 된다 */}
              {exhibition.recruitOnly && (
                <p className="mt-2.5 text-[13px] text-gray-600 break-keep">지원자 선정(수락)까지 진행해요. 출품 자료·전시 운영·정산 단계는 없어요.</p>
              )}
            </section>

            {/* 첨부파일(2026-10-08) — 모집 요강·지원서 양식. 소개 글보다 위(긴 공고의 맨 끝에 있으면 못 찾는다, 2026-11-15) */}
            <div className="mt-8">
              <AttachmentsSection exhibitionId={id!} items={normalizeAttachments(exhibition.attachments)} canEdit={canEdit} />
            </div>

            {/* 설명 (갤러리 오너만 수정 가능) — ⚠️ div > div > h2 구조를 지킬 것(e2e 67 이 이 모양으로 찾는다) */}
            <div className="mt-10 lg:mt-12">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[19px] font-semibold tracking-tight text-gray-900 lg:text-[22px]">공모 소개</h2>
                {canEdit && !isEditingDesc && (
                  <button
                    onClick={() => { setEditDesc(exhibition.description); setIsEditingDesc(true); }}
                    className="flex min-h-[40px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
                    aria-label="수정"
                  >
                    <Edit3 size={14} aria-hidden /> 수정
                  </button>
                )}
              </div>
              {/* 서식 있는 글(2026-10-03, 갤러리 소개와 같은 편집기) — 제목·굵게·목록·링크. 서버가 허용 목록으로 걸러 저장하고 화면도 한 번 더 거른다 */}
              {isEditingDesc ? (
                <div className="space-y-2">
                  <LazyRichTextEditor
                    value={editDesc}
                    onChange={setEditDesc}
                    placeholder="공모 소개"
                    maxLength={20000}
                    minHeight={220}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => descMutation.mutate(editDesc)}
                      disabled={descMutation.isPending}
                      className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >저장</button>
                    <button onClick={() => setIsEditingDesc(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
                  </div>
                </div>
              ) : (
                <RichText value={exhibition.description} className="text-[15px] leading-[1.85] text-gray-700 break-keep [overflow-wrap:anywhere] lg:text-base" />
              )}
            </div>

            {/* 홍보 사진 (종료된 전시) — 갤러리 페이지와 같은 정사각 칸 격자. 예전엔 높이 96px 고정에 잘라 채워서 사진이 가로 띠가 됐다(규칙 18·50) */}
            {exhibition.promoPhotos && exhibition.promoPhotos.length > 0 && (
              <div className="mt-10">
                <h2 className="mb-3 text-[19px] font-semibold tracking-tight text-gray-900 lg:text-[22px]">홍보 사진</h2>
                <SquarePhotoGrid
                  photos={exhibition.promoPhotos.map((photo) => ({ url: photo.url, caption: photo.caption, key: photo.id }))}
                  onOpen={(idx) => setLightbox({ images: exhibition.promoPhotos!.map(p => p.url), index: idx })}
                />
              </div>
            )}

            {/* 휴대폰 — 운영자의 포스터 관리는 본문 아래(PC 는 왼쪽 포스터 아래) */}
            {!wide && canEdit && exhibition.images && (
              <div className="mt-8"><ExhibitionImageManager exhibitionId={exhibition.id} images={exhibition.images} /></div>
            )}

            {/* 주최 갤러리 — 갤러리 주최 공모만. 휴대폰은 [갤러리에 문의]가 여기 붙는다(PC 는 머리의 단추 줄) */}
            {host && !adminHosted && (
              <section aria-labelledby="ex-host" className="mt-12 border-t border-gray-200 pt-6">
                <h2 id="ex-host" className={DETAIL_LABEL}>주최</h2>
                <Link to={galleryPath(host)} className="group/host mt-3 flex items-center gap-4 lg:gap-5">
                  <SkeletonImage
                    src={host.mainImage || ''}
                    thumb="list"
                    alt=""
                    fallbackLabel={host.name}
                    className="aspect-[4/3] w-[112px] shrink-0 lg:w-[176px]"
                    imgClassName="object-contain"
                    blurFill
                    loading="lazy"
                  />
                  <span className="min-w-0">
                    <span className="block text-[17px] font-medium text-gray-900 group-hover/host:underline group-hover/host:underline-offset-4 lg:text-[19px]">{host.name}</span>
                    {host.description && <span className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-gray-600 break-keep [overflow-wrap:anywhere] lg:text-sm">{host.description}</span>}
                    <span className="mt-1.5 block text-xs text-gray-500">{addressArea(host.address, host.region)}</span>
                  </span>
                </Link>
                {!wide && askButton && <div className="mt-2">{askButton}</div>}
              </section>
            )}

            {/* 초대 코드 — 이미 선정돼 갤러리에게 코드를 받은 작가용 보조 입구. 모집 마감 뒤에도 전시 종료 전까지 쓴다(서버와 같은 기준).
                누르면 `/join/코드` 로 가서 어떤 공모인지 확인하고 참여한다 */}
            {((isArtist && !exhibition.myApplication) || !isAuthenticated) && !exhibition.ended && (
              <div className="mt-10">
                {showCodeInput ? (
                  <JoinCodeInput compact />
                ) : (
                  <button onClick={() => setShowCodeInput(true)} className="min-h-[40px] w-full text-center text-xs text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline">
                    이미 선정되어 초대 코드를 받으셨나요?
                  </button>
                )}
              </div>
            )}

            {/* Gallery 오너 / Admin 삭제 — 오른쪽 아래 소형. 삭제 요청을 보내 둔 동안은 버튼 대신 요청 상태 */}
            {canDeleteExhibition && <div className="mt-6"><DeleteRequestLine request={deleteRequestOf('exhibition', exhibition.id)} kind="exhibition" /></div>}
            {canDeleteExhibition && deleteRequestOf('exhibition', exhibition.id)?.status !== 'PENDING' && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="flex min-h-[40px] cursor-pointer items-center gap-1 text-xs text-gray-500 hover:text-accent disabled:opacity-50"
                  aria-label="공모 삭제"
                >
                  <Trash2 size={13} aria-hidden /> 공모 삭제
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 다른 모집공고 — 다 읽고 갈 곳(예전엔 끝이 막다른 길이었다). 모집공고 목록과 같은 캐시라 목록에서 왔으면 다시 받지 않는다 */}
        {others.length > 0 && (
          <section aria-labelledby="ex-more" className="mt-14 border-t border-gray-200 pt-8 lg:mt-20">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="ex-more" className="text-[19px] font-semibold tracking-tight text-gray-900 lg:text-[22px]">다른 모집공고</h2>
              <Link to="/exhibitions" className="text-sm text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline">전체 보기</Link>
            </div>
            <ul className="mt-3 grid gap-x-10 lg:mt-5 lg:grid-cols-3">
              {others.map((o) => <MoreCall key={o.id} ex={o} />)}
            </ul>
          </section>
        )}
      </div>

      {/*
        따라오는 [지원하기] (2026-10-03 점검 P3) — 휴대폰은 하단 탭바 위, PC 는 화면 맨 아래. 화면에 [지원하기]는 이것 하나뿐이다.
        왼쪽은 마감(D-9 · 11.24(화)까지 — 목록·머리와 같은 말, lib/listings deadlineView), PC 는 공모 제목도.
        ⚠️ **바깥 래퍼(페이지 맨 위부터 시작)의 자식**이어야 한다. 본문 칸 안에 두면 sticky 가 본문이 시작되는 곳부터만 붙는다.
      */}
      {applyBar && (
        <div data-apply-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mt-12 border-t border-gray-200 bg-white/95 backdrop-blur lg:bottom-0">
          <div className="mx-auto flex max-w-7xl items-center gap-x-4 gap-y-2 px-6 py-3 md:px-12">
            {applyBar.primary ? (
              // 마감 — 휴대폰은 두 줄(D-9 / 11.24(화)까지), PC 는 한 줄 + 제목 + (있으면) 안내 한 줄. 버튼이 둘이면 휴대폰에선 감춘다(자리가 없다)
              <div className={cn('min-w-0 shrink-0 sm:flex-1', applyBar.secondary && 'hidden sm:block')}>
                <p className="text-[12px] leading-tight text-gray-600 sm:truncate sm:text-sm">
                  <b className={cn('block text-[15px] font-bold sm:inline sm:text-sm', dv.hot ? 'text-accent' : 'text-gray-900')}>{dv.badge}</b>
                  <span className="sm:ml-2">{dv.date}</span>
                  {wide && <span className="ml-3 text-gray-900">{exhibition.title}</span>}
                </p>
                {applyBar.note && <p className="mt-0.5 hidden truncate text-xs text-gray-500 lg:block">{applyBar.note}</p>}
              </div>
            ) : (
              <p className="min-w-0 flex-1 text-xs text-gray-600">{applyBar.note}</p>
            )}
            {applyBar.secondary}
            {applyBar.sub ? (
              // 버튼과 그 아래 한 줄을 한 덩어리로 — 휴대폰은 줄을 채우고 가운데, PC 는 버튼 폭 그대로 오른쪽 정렬
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none sm:items-end">
                {applyBar.primary}
                <p data-apply-sub className="text-center text-xs text-gray-500 sm:text-right">{applyBar.sub}</p>
              </div>
            ) : applyBar.primary}
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      <ConfirmDialog
        open={deleteConfirm}
        title="공모 삭제"
        message="정말 이 공모를 삭제하시겠습니까? 관련 지원 내역도 모두 삭제되고, 지원한 작가에게 삭제 알림이 가요."
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { setDeleteConfirm(false); deleteMutation.mutate(); }}
        onCancel={() => setDeleteConfirm(false)}
      />
      <DeleteRequestDialog
        open={!!deleteBlocked}
        kind="exhibition"
        targetId={exhibition.id}
        name={exhibition.title}
        blockedReason={deleteBlocked ?? ''}
        onClose={() => setDeleteBlocked(null)}
      />

      {/* 초대 간편 지원 모달 */}
      {showInviteApply && (
        <InviteApplyModal
          exhibitionId={exhibition.id}
          exhibitionTitle={exhibition.title}
          galleryName={exhibition.gallery?.name ?? '아트링크'}
          customFields={exhibition.customFields}
          onClose={() => setShowInviteApply(false)}
        />
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
    </div>
  );
}


/** '다른 모집공고' 한 줄 — 작은 포스터 · 마감 · 제목 · 주최 */
function MoreCall({ ex }: { ex: Exhibition }) {
  const dv = deadlineView(ex);
  return (
    <li className="border-b border-gray-100 lg:border-0">
      <Link to={`/exhibitions/${ex.id}`} className="group/more flex gap-4 py-4 lg:py-0">
        <SkeletonImage
          src={ex.imageUrl || ex.gallery?.mainImage || ''}
          thumb="list"
          alt=""
          fallbackLabel={ex.title}
          className="aspect-[210/297] w-[64px] shrink-0 lg:w-[76px]"
          imgClassName="object-contain"
          blurFill
          loading="lazy"
        />
        <span className="min-w-0">
          <span className="block text-xs text-gray-500">
            <b className={cn('font-bold', dv.hot ? 'text-accent' : 'text-gray-900')}>{dv.badge}</b>
            {dv.date && <span className="ml-1.5">{dv.date}</span>}
          </span>
          <span className="mt-1 line-clamp-2 text-[15px] font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere] group-hover/more:underline group-hover/more:underline-offset-2">{ex.title}</span>
          <span className="mt-1 block truncate text-xs text-gray-600">
            {isAdminHosted(ex) ? <ArtLinkWordmark className="text-[13px]" /> : ex.gallery?.name}
          </span>
        </span>
      </Link>
    </li>
  );
}

// =============================================
// 오너 전용: 공모 사진 관리 (추가 / 삭제(최소 1장) / 드래그 순서변경)
// =============================================
const MAX_EXHIBITION_IMAGES = 20;

function ExhibitionImageManager({ exhibitionId, images }: { exhibitionId: number; images: ExhibitionImage[] }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [order, setOrder] = useState<ExhibitionImage[]>(images);
  const dragId = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 서버 데이터 변경 시 로컬 순서 동기화
  useEffect(() => { setOrder(images); }, [images]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['exhibition', String(exhibitionId)] });
    queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
  };

  const addMutation = useMutation({
    mutationFn: (url: string) => api.post(`/exhibitions/${exhibitionId}/images`, { url }),
    onSuccess: invalidate,
    onError: () => toast.error('사진 추가에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: number) => api.delete(`/exhibitions/${exhibitionId}/images/${imageId}`),
    onSuccess: () => { invalidate(); toast.success('사진이 삭제되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '사진 삭제에 실패했습니다.'),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: number[]) => api.patch(`/exhibitions/${exhibitionId}/images/reorder`, { orderedIds }),
    onSuccess: invalidate,
    onError: () => { toast.error('순서 변경에 실패했습니다.'); setOrder(images); },
  });

  const handleDelete = (imageId: number) => {
    // 최소 1장 유지 — 마지막 한 장은 삭제 불가 안내
    if (order.length <= 1) {
      toast.error('사진은 최소 한 장 이상 등록되어 있어야 합니다.');
      return;
    }
    if (window.confirm('이 사진을 삭제하시겠습니까?')) deleteMutation.mutate(imageId);
  };

  const handleUpload = async (files: FileList) => {
    const remaining = MAX_EXHIBITION_IMAGES - order.length;
    if (remaining <= 0) { toast.error(`사진은 최대 ${MAX_EXHIBITION_IMAGES}장까지 등록 가능합니다.`); return; }
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
        const res = await api.post('/upload/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        await addMutation.mutateAsync(res.data.url);
        count++;
      } catch { toast.error(`${rawFile.name} 업로드 실패`); }
    }
    if (count > 0) toast.success(`${count}장 추가되었습니다.`);
    setUploading(false);
  };

  const handleDropUpload = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      handleUpload(dt.files);
    } else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };

  // 썸네일 드래그 순서변경
  const onThumbDrop = (targetId: number) => {
    const fromId = dragId.current;
    dragId.current = null;
    if (fromId == null || fromId === targetId) return;
    const fromIdx = order.findIndex(i => i.id === fromId);
    const toIdx = order.findIndex(i => i.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...order];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);
    reorderMutation.mutate(next.map(i => i.id));
  };

  return (
    <div className="pt-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
        aria-label="포스터 관리"
      >
        <Camera size={14} /> 포스터 관리 ({order.length})
        <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`mt-3 p-3 bg-gray-50 rounded-lg ${dragOver ? 'ring-2 ring-gray-400' : ''}`}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={handleDropUpload}
        >
          <p className="text-xs text-gray-400 mb-2">썸네일을 드래그해 순서를 바꿀 수 있어요. 첫 번째 포스터가 대표 이미지이며, 상세 페이지에 순서대로 세로로 표시됩니다.</p>
          <div
            className="grid grid-cols-4 sm:grid-cols-5 gap-2"
            onDragEnter={() => setDragOver(false)}
          >
            {order.map((img) => (
              <div
                key={img.id}
                draggable
                onDragStart={() => { dragId.current = img.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onThumbDrop(img.id); }}
                className="relative group cursor-grab active:cursor-grabbing"
              >
                <img src={img.url} alt="공모 사진" className="w-full h-20 object-cover rounded-lg pointer-events-none" />
                <span className="absolute bottom-1 left-1 p-0.5 bg-black/40 text-white rounded">
                  <GripVertical size={11} />
                </span>
                <button
                  onClick={() => handleDelete(img.id)}
                  className="absolute top-1 right-1 p-0.5 bg-accent text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="삭제"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {order.length < MAX_EXHIBITION_IMAGES && (
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="h-20 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="사진 추가"
              >
                <Plus size={18} />
                <span className="text-[11px]">{uploading ? '업로드 중' : '추가'}</span>
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 작가 자료제출 마감일 줄 — 공모기간과 전시기간 사이에 놓인다.
 *
 * ── 세 가지 상태 ────────────────────────────────────────────
 *   값이 있음            날짜만 보여준다 (수정 버튼 없음)
 *   값이 없음 + 운영자    [입력] 버튼 → 한 번만 넣을 수 있다
 *   값이 없음 + 그 외     아무것도 안 보인다 (없는 기한을 지어내지 않는다)
 *
 * ⚠️ 한 번 넣으면 갤러리는 못 고친다(서버가 403). 작가가 이 날짜를 보고 일정을 잡기 때문에,
 *    뒤늦게 당기면 안내받은 기한이 조용히 바뀐다. 오타 구제는 Admin 에게만 열려 있다.
 * ⚠️ 전시가 이미 시작된 공모에는 입력 버튼을 띄우지 않는다 — 지난 날짜를 적는 건 의미가 없고,
 *    작가 화면에 '이미 지난 마감'이 새로 생기는 것도 이상하다.
 */
function SubmissionDeadlineRow({ exhibition, canEdit, isAdmin }: { exhibition: ExhibitionDetail; canEdit: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const start = exhibition.exhibitStartDate || exhibition.exhibitDate;
  const started = start ? getDday(start) <= 0 : false;   // KST 달력 날짜 기준(규칙 14) — 순수 Date 비교는 당일 09시에 어긋난다
  // ⚠️ 공모만 진행하는 공고에는 자료제출 단계가 **없다** — 서버도 400 으로 막는다.
  //    [입력] 버튼을 남겨두면 눌러보고 에러를 받는 함정이 된다.
  const canFill = !exhibition.recruitOnly && canEdit && (!exhibition.submissionDeadline || isAdmin) && (!started || isAdmin);

  const save = useMutation({
    mutationFn: () => api.patch(`/exhibitions/${exhibition.id}/submission-deadline`, { submissionDeadline: value }),
    onSuccess: () => {
      toast.success('출품 자료 제출 마감일을 저장했습니다.');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['exhibition', String(exhibition.id)] });
      qc.invalidateQueries({ queryKey: ['exhibition', exhibition.id] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장에 실패했습니다.'),
  });

  // 날짜는 위 일정 띠가 보여 준다 — 여기는 운영자의 입력·수정 줄뿐이다
  if (!canFill) return null;

  // 달력 자체를 유효 범위로 막는다 — 틀린 날짜를 고르고 저장에서 튕기는 일이 없게
  const ymd = (v: string | Date) => new Date(v).toISOString().slice(0, 10);
  const dayShift = (v: string | Date, n: number) => ymd(new Date(new Date(v).getTime() + n * 86400000));

  return (
    <div className="mt-4">
      {editing ? (
        <>
          <p className="text-[13px] text-gray-600">출품 자료 제출 마감일</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={dayShift(exhibition.deadline, 1)}
              max={start ? dayShift(start, -1) : undefined}
              aria-label="출품 자료 제출 마감일"
              className="min-h-10 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
            <button onClick={() => save.mutate()} disabled={!value || save.isPending}
              className="min-h-10 rounded-lg bg-gray-900 px-3 text-sm text-white hover:bg-gray-800 disabled:opacity-50">
              {save.isPending ? '저장 중...' : '저장'}
            </button>
            <button onClick={() => setEditing(false)} className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50">
              취소
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            접수 마감일 다음날 ~ 전시 시작일 전날 사이로 정해주세요.
            {!isAdmin && ' 한 번 저장하면 변경할 수 없습니다.'}
          </p>
        </>
      ) : (
        <button
          onClick={() => { setValue(exhibition.submissionDeadline ? ymd(exhibition.submissionDeadline) : ''); setEditing(true); }}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Edit3 size={12} aria-hidden /> 출품 자료 제출 마감일 {exhibition.submissionDeadline ? '수정' : '입력'}
        </button>
      )}
    </div>
  );
}

/**
 * 지역 (2026-10-08) — 올린 뒤에도 바꿀 수 있다. 갤러리 주최 공모는 그 갤러리, 아트링크 주최 공모는 관리자만(`canChangeRegion`).
 * 목록 필터에만 쓰이는 값이라 승인 없이 바로 바뀐다(서버 `PATCH /exhibitions/:id/region`).
 */
function RegionRow({ exhibition, canChange }: { exhibition: ExhibitionDetail; canChange: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(exhibition.region);

  const save = useMutation({
    mutationFn: () => api.patch(`/exhibitions/${exhibition.id}/region`, { region: value }),
    onSuccess: () => {
      toast.success('지역을 바꿨습니다.');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['exhibition', String(exhibition.id)] });
      qc.invalidateQueries({ queryKey: ['exhibition', exhibition.id] });
      qc.invalidateQueries({ queryKey: ['exhibitions'] });
      qc.invalidateQueries({ queryKey: ['my-exhibitions'] });
      qc.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장에 실패했습니다.'),
  });

  return (
    <div className={cn('min-w-0 py-3', editing && 'col-span-full')}>
      <dt className="text-[12px] text-gray-500 lg:text-[13px]">지역</dt>
      <dd className="mt-1 text-[15px] font-medium text-gray-900 lg:text-base">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="지역 고르기"
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-normal"
            >
              {REGION_CODES.map((r) => <option key={r} value={r}>{regionLabels[r]}</option>)}
            </select>
            <button onClick={() => save.mutate()} disabled={value === exhibition.region || save.isPending}
              className="min-h-10 rounded-lg bg-gray-900 px-3 text-sm font-normal text-white hover:bg-gray-800 disabled:opacity-50">
              {save.isPending ? '저장 중...' : '저장'}
            </button>
            <button onClick={() => setEditing(false)} className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm font-normal text-gray-700 hover:bg-gray-50">
              취소
            </button>
          </div>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-x-2">
            {regionLabels[exhibition.region] ?? exhibition.region}
            {canChange && (
              <button
                onClick={() => { setValue(exhibition.region); setEditing(true); }}
                aria-label="지역 변경"
                className="inline-flex min-h-[32px] items-center gap-1 text-xs font-normal text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline"
              >
                <Edit3 size={12} aria-hidden /> 변경
              </button>
            )}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * 첨부파일 (2026-10-08) — 누구나 내려받는다. 운영 갤러리·관리자는 [편집]으로 바로 고친다(공모 소개와 같은 권한, 승인 없이).
 * 비어 있으면 방문자에게는 그리지 않는다 — 고칠 수 있는 사람에게만 채울 자리를 보인다.
 * ⚠️ 버튼 이름에 '수정' 을 넣지 말 것 — 바로 위 [공모 소개]의 [수정] 과 이름이 겹쳐 화면 낭독기·테스트가 둘을 가르지 못한다.
 */
function AttachmentsSection({ exhibitionId, items, canEdit }: { exhibitionId: string; items: ExhibitionAttachment[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ExhibitionAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const save = useMutation({
    mutationFn: (list: ExhibitionAttachment[]) => api.patch(`/exhibitions/${exhibitionId}/attachments`, { attachments: list }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', exhibitionId] });
      setEditing(false);
      toast.success('첨부파일을 저장했어요.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장하지 못했어요.'),
  });

  if (!editing && items.length === 0 && !canEdit) return null;
  return (
    <section aria-labelledby="ex-attachments">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="ex-attachments" className={DETAIL_LABEL}>첨부파일</h2>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => { setDraft(items); setEditing(true); }}
            className="flex min-h-[36px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
            aria-label={items.length ? '첨부파일 편집' : '첨부파일 추가'}
          >
            {items.length ? <><Edit3 size={14} /> 편집</> : <><Plus size={14} /> 추가</>}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <AttachmentEditor value={draft} onChange={(update) => setDraft((prev) => update(prev))} onBusyChange={setBusy} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => save.mutate(draft)}
              disabled={save.isPending || busy}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >저장</button>
            <button type="button" onClick={() => setEditing(false)} disabled={save.isPending} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      ) : items.length ? (
        <AttachmentList items={items} />
      ) : (
        <p className="text-sm text-gray-500">모집 요강·지원서 양식 같은 파일을 붙이면 누구나 내려받을 수 있어요.</p>
      )}
    </section>
  );
}
