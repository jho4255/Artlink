import { useState, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  Heart, Plus, Camera, Eye, Search, Calendar, Edit3, Trash2, Instagram, Save, AlertTriangle, Phone, Mail, ArrowLeft, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, exhibitionTypeLabels, getDday, capacityPayload, capacityText, type CapacityMask, displayName, formatPhoneNumber, roleLabel, cn } from '@/lib/utils';
import { stageOf, applicationStatusView, galleryNextTask, artistNextTask, flowStrip, gallerySubText, artistSubText, artistWaitText, viewForTarget, WORKSPACE_VIEWS, type ArtistSnapshot, type ArtistView, type TaskActionId, type WorkspaceView } from '@/lib/flowLabels';
import ExhibitionRow, { RowGroupHead } from '@/components/flow/ExhibitionRow';
import ExhibitionWorkspace from '@/components/workspace/ExhibitionWorkspace';
import ArtistExhibitionWorkspace from '@/components/workspace/ArtistExhibitionWorkspace';
import { rememberListScroll, takeListScroll } from '@/lib/listScroll';
import { scheduleSummary } from '@/lib/scheduleSummary';
import { uploadAvatar } from '@/lib/avatarUpload';
import Notice from '@/components/flow/Notice';
import DraftNotice from '@/components/flow/DraftNotice';
import Disclosure from '@/components/flow/Disclosure';
import PageTabBar from '@/components/shared/PageTabBar';
import { FormField } from '@/components/flow/FormParts';
import { formInputCls } from '@/lib/formStyles';
import ImageUpload from '@/components/shared/ImageUpload';
import { groupMyExhibitions, defaultBucket, isRejected, bucketOf, MY_EXHIBITION_TABS, MY_EXHIBITION_EMPTY, type MyExhibitionBucket } from '@/lib/myExhibitions';
import PortfolioMaker from '@/components/portfolio-maker/PortfolioMaker';
import HomepageEditor from '@/components/homepage-edit/HomepageEditor';
import HomepageAddressField from '@/components/shared/HomepageAddressField';
import ArtistHomepageLine from '@/components/shared/ArtistHomepageLine';
import { normalizeHandle, suggestHandle, validateHandle } from '@/lib/handle';
import Thumb from '@/components/shared/Thumb';
import { myPageTabs, resolveTab, aliasTab, tabHref, defaultTabFor } from '@/lib/myPageMenu';
import { useAdminTodo, badgeCount } from '@/hooks/useAdminTodo';
import MenuBadge from '@/components/layout/MenuBadge';
import { editHref } from '@/lib/homepageEdit';
import HeroToneField, { useHeroAutoTones, type HeroToneChoice } from '@/components/admin/HeroToneField';
import { TONE_CLASS } from '@/lib/heroTone';
import JoinCodeInput from '@/components/shared/JoinCodeInput';
import { sanitizeCustomFields } from '@/components/shared/CustomQuestionsEditor';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useUnsavedChanges, hasUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { DeleteRequestDialog, DeleteRequestLine } from '@/components/shared/DeleteRequest';
import { checkDeletable, useMyDeleteRequests } from '@/hooks/useDeleteRequests';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ConfirmDeleteButton from '@/components/shared/ConfirmDeleteButton';
import DeleteConfirmModal from '@/components/shared/DeleteConfirmModal';
import ArtworkDetailModal from '@/components/shared/ArtworkDetailModal';
import { stageArtLookWorks, portfolioArtLookWorks, readArtLookMessage, COMPOSE_STATE_KEY, ARTLOOK_EMBED_URL } from '@/lib/artlook';
import { useArtLookBare } from '@/hooks/useArtLookBare';
import { useFillHeight } from '@/hooks/useFillHeight';
import HostedExhibitionsSection from '@/components/admin/HostedExhibitionsSection';
import ApprovalsSection from '@/components/admin/ApprovalsSection';
import UserManageSection from '@/components/admin/UserManageSection';
import OversightSection from '@/components/admin/OversightSection';
import KanbanSection from '@/components/admin/KanbanSection';
import AdminStatsSection from '@/components/admin/AdminStatsSection';
import AdManageSection from '@/components/admin/AdManageSection';
import HostBadge from '@/components/shared/HostBadge';
import StoryReportsSection from '@/components/admin/StoryReportsSection';
import ChatReportsSection from '@/components/admin/ChatReportsSection';
import BlockedUsersSection from '@/components/chat/BlockedUsersSection';
import { ExhibitionFormBody } from '@/components/exhibition-form/ExhibitionFormBody';
import { exhibitionMissing, exhibitionDateError, exhibitionPreview } from '@/components/exhibition-form/exhibitionForm';
import { jumpToField } from '@/lib/formJump';
import { GalleryFormBody } from '@/components/gallery-form/GalleryFormBody';
import { emptyGalleryForm, fullAddress, galleryEmailError, galleryMissing, galleryPreview, type GalFormValues } from '@/components/gallery-form/galleryForm';
import { ShowFormBody } from '@/components/show-form/ShowFormBody';
import { emptyShowForm, openingHoursError, showMissing, showPreview, type ShowFormValues } from '@/components/show-form/showForm';
import StickySubmitBar from '@/components/form/StickySubmitBar';
import SubmitSheet from '@/components/form/SubmitSheet';
import { PreviewAside, PreviewSheet } from '@/components/form/PreviewPane';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import ReceivedInquiriesSection from '@/components/homepage/ReceivedInquiriesSection';
import { normalizeAttachments, type ExhibitionAttachment } from '@/lib/attachments';
import type { Favorite, Portfolio, Gallery, Exhibition, Show, ArtistEntry, CustomField, ExploreImage } from '@/types';


/**
 * 내 공모 목록 필터.
 * 예전엔 `'operation' | 'classic'`(신규 운영 보기 / 기존 목록 보기) 두 벌의 **렌더링 토글**이었는데,
 * 같은 목록을 두 가지로 그리다 보니 한쪽만 뒤처졌다(단계 배지·다음 할 일이 신규에만 있었다).
 * 게다가 끝난 공모가 목록에 계속 쌓여 진행 중인 걸 찾기 어려웠다.
 * 그래서 렌더링은 운영 허브 한 벌로 통일하고, 토글 자리를 **진행/종료 필터**로 바꿨다.
 */
type ExhibitionViewMode = 'active' | 'closed';
type OperationTone = 'active' | 'wait' | 'accent' | 'done' | 'danger';

interface GalleryOperationOverview {
  id: number;
  title: string;
  type: string;
  region: string;
  imageUrl?: string | null;
  status: string;
  /** 'ADMIN'이면 아트링크 주최 공모 — 우리 갤러리는 운영만 위임받았다 */
  hostType?: 'GALLERY' | 'ADMIN';
  /** 공모만 진행 — 작가 자료·판매/정산 칸을 그리지 않는다 */
  recruitOnly?: boolean;
  /** 선정 인원(정원). 지원은 무제한이고 수락이 이 수를 넘지 못한다(2026-09-27) */
  capacity?: number;
  /** 공고에 0명·00명으로 적었는가 — 그럴 때 capacity 는 한도(9·99) */
  capacityMask?: 'ONE' | 'TWO' | null;
  rejectReason?: string | null;
  deadlineStart?: string | null;
  deadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  /** 출품 자료 제출 마감일 — 목록 줄의 '출품 자료 마감 D-n' */
  submissionDeadline?: string | null;
  recruitmentClosed?: boolean;
  confirmed?: boolean;
  ended?: boolean;
  settlementRequestedAt?: string | null;
  settledAt?: string | null;
  /** 서버가 계산한 종료(정산 완료 또는 전시 종료 20일 경과) */
  closed?: boolean;
  gallery?: { id: number; name: string };
  /** 상세 조회수 — 내가 올린 공모만 온다(운영만 위임받은 아트링크 주최 공모는 null) */
  viewCount?: number | null;
  stage: { key: string; label: string; tone: OperationTone };
  nextAction: { label: string; description: string; route: string };
  counts: {
    applications: { total: number; submitted: number; reviewed: number; accepted: number; rejected: number };
    submissions: { required: number; submitted: number; complete: number };
    sales: { total: number };
    settlement: { total: number; pending: number; approved: number; issue: number };
  };
}

const makeFallbackOperationOverview = (ex: any): GalleryOperationOverview => ({
  id: ex.id,
  title: ex.title,
  type: ex.type,
  region: ex.region,
  imageUrl: ex.imageUrl,
  status: ex.status,
  hostType: ex.hostType,
  rejectReason: ex.rejectReason,
  deadlineStart: ex.deadlineStart,
  deadline: ex.deadline,
  exhibitStartDate: ex.exhibitStartDate,
  exhibitDate: ex.exhibitDate,
  recruitmentClosed: ex.recruitmentClosed,
  confirmed: ex.confirmed,
  ended: ex.ended,
  settlementRequestedAt: ex.settlementRequestedAt,
  settledAt: ex.settledAt,
  gallery: ex.gallery,
  stage: {
    key: ex.status === 'APPROVED' ? 'recruiting' : ex.status === 'REJECTED' ? 'rejected' : 'review',
    label: ex.status === 'APPROVED' ? '모집 중' : ex.status === 'REJECTED' ? '반려' : '승인 대기',
    tone: ex.status === 'APPROVED' ? 'active' : ex.status === 'REJECTED' ? 'danger' : 'wait',
  },
  nextAction: {
    label: ex.status === 'APPROVED' ? '지원자 관리' : '공모 상세 보기',
    description: ex.status === 'APPROVED' ? '접수 현황을 확인하고 지원자 상태를 관리합니다.' : '관리자 승인 상태와 공모 내용을 확인합니다.',
    route: `/exhibitions/${ex.id}`,
  },
  counts: {
    applications: { total: 0, submitted: 0, reviewed: 0, accepted: 0, rejected: 0 },
    submissions: { required: 0, submitted: 0, complete: 0 },
    sales: { total: 0 },
    settlement: { total: 0, pending: 0, approved: 0, issue: 0 },
  },
});


export default function MyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    // 쿼리가 없으면 그 역할의 첫 화면 — 대개 프로필, 관리자는 [통계](2026-11-21)
    return tab === 'my-exhibitions-classic' ? 'my-exhibitions' : (tab || defaultTabFor(useAuthStore.getState().user?.role));
  });

  // 다른 페이지에서 ?tab=... 로 진입 시(이미 /mypage에 있을 때 포함) 해당 탭으로 전환
  useEffect(() => {
    const rawTab = searchParams.get('tab');
    // 옛 딥링크(?tab=my-exhibitions-classic) 호환 — 클래식 목록은 없어졌으므로 '내 공모' 로만 보낸다
    if (rawTab === 'my-exhibitions-classic') { setSearchParams({ tab: 'my-exhibitions' }, { replace: true }); return; }
    /*
      다른 역할의 탭 주소로 들어왔으면(관리자가 갤러리의 [내 공모] 링크를 열었다) 같은 일을 하는 탭으로 주소를 갈아끼운다.
      `resolveTab` 이 내용은 이미 그 탭으로 그리지만, 주소가 옛 값으로 남으면 새로고침·공유 때 헷갈린다. `ex=` 등 나머지는 그대로 둔다.
    */
    const alias = aliasTab(user?.role, rawTab);
    if (alias) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', alias);
      setSearchParams(next, { replace: true });
      return;
    }
    /*
      ⚠️ `?tab=` 이 **없을 때도** 반드시 되돌려야 한다.
      예전엔 `if (t && ...)` 라 값이 없으면 아무것도 안 했다 → 사이드바에서 [프로필](= `/mypage`, 쿼리 없음)을
      누르면 주소만 바뀌고 화면은 이전 탭에 머물렀다(갤러리 계정에서 프로필↔내 갤러리 왕복 시 신고, 2026-08-28).
      프로필은 기본 탭이라 쿼리를 안 붙이므로(myPageHref) 이 경로가 매번 걸린다.
    */
    const t = rawTab ?? defaultTabFor(user?.role);
    if (t !== activeTab) setActiveTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const selectTab = (id: string) => {
    setActiveTab(id);
    setSearchParams(id === defaultTabFor(user?.role) ? {} : { tab: id }, { replace: true });
  };

  // 모바일에서 탭이 화면을 넘어갈 때(Admin 8개 등) 우측 페이드로 "더 있음"을 알림
  // (훅은 아래 early return보다 먼저 호출되어야 함)
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabOverflowRight, setTabOverflowRight] = useState(false);
  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const update = () => setTabOverflowRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [user?.role]);

  /** 휴대폰 편집 전용 화면(2026-11-17, 규칙 85) — 상단바·하단 탭바가 없으니 여백도 없이 iframe 이 화면을 다 쓴다.
   *  ⚠️ 훅이라 아래 `if (!user) return null` **위에**(hooksBeforeReturn.test.ts — 로그아웃 순간 React #310) */
  const bare = useArtLookBare();
  // 관리자 메뉴 배지(가로 탭 줄, 2026-11-21) — 훅이라 아래 return 위에
  const { data: adminTodo } = useAdminTodo();

  if (!user) return null;

  // 메뉴 정의는 lib/myPageMenu.ts 하나뿐 — 우측 사이드바(Layout)·Navbar 모바일 메뉴와 같은 것을 쓴다
  const tabs = myPageTabs(user.role);

  // 역할과 맞지 않는 ?tab= 값으로 진입하면 빈 화면이 되므로 첫 유효 탭(프로필)으로 폴백.
  // 사이드바도 같은 resolveTab 을 써야 강조와 내용이 어긋나지 않는다.
  const currentTab = resolveTab(user.role, activeTab);
  /**
   * 공모 한 건 화면(2026-11-20, 규칙 88) — [내 공모]·[내 전시] 에서 공모를 열면(`?ex=`) 본문 전체가 그 화면이다.
   * 프로필 카드·휴대폰 가로 탭 줄을 그리지 않는다(홈페이지 편집과 같은 '한 가지 일' 화면).
   * 두 목록 화면도 프로필 카드를 그리지 않는다(D4) — 목록 위 240px 가 '지금 할 일' 을 첫 화면 밖으로 밀었다.
   */
  const listTab = (currentTab === 'my-exhibitions' && user.role === 'GALLERY') || (currentTab === 'applications' && user.role === 'ARTIST');
  // 관리자 [주최 공모]의 공모 한 건 화면·등록 화면도 그 일만 하는 화면이다(2026-11-21)
  const hostedFocus = currentTab === 'hosted-exhibitions' && user.role === 'ADMIN' && (!!searchParams.get('ex') || searchParams.get('new') === '1');
  const workspaceOpen = (listTab && !!searchParams.get('ex')) || hostedFocus;
  /** 관리자 화면에는 프로필 카드를 두지 않는다(2026-11-21) — 첫 화면의 45%를 먹었다. [프로필] 탭에서만 */
  const adminWork = user.role === 'ADMIN' && currentTab !== 'profile';
  /**
   * 한 가지 일에 집중하는 화면인가 — 작가의 홈페이지 편집 · 포트폴리오 PDF 만들기(2026-10-03).
   * 둘 다 **아래에 붙는 바**가 있고 첫 화면에 결과물이 보여야 하는 화면이다. 프로필 카드(240px)·가로 탭바를 위에 두면
   * 포트폴리오 화면의 미리보기가 첫 화면 밖으로 밀렸다(PC y894 · 휴대폰 y1375).
   */
  const focused = ((currentTab === 'homepage-edit' || currentTab === 'portfolio' || currentTab === 'artlook') && user.role === 'ARTIST') || workspaceOpen;
  /** 화면을 끝까지 채우는 도구 — ArtLook(2026-10-04). 휴대폰은 좌우 여백도 없이 가장자리까지(미리보기를 한 치라도 더) */
  const fill = currentTab === 'artlook' && user.role === 'ARTIST';

  return (
    <div className={cn('max-w-7xl mx-auto', bare ? 'px-0' : fill ? 'px-0 sm:px-6 lg:px-8 sm:pt-6' : 'px-6 md:px-12', !fill && (focused ? 'pt-6 md:pt-10' : 'py-10 md:py-16'))}>
      {/* 'My Page' 제목은 두지 않는다 — 우측 사이드바가 현재 위치를 알려주고,
          각 탭이 제 이름을 갖는다(예: 포트폴리오 탭의 PortFolio).
          로그아웃도 여기 없다 — Navbar 우측으로 일원화 */}
      {/*
        홈페이지 편집 화면은 **그 일만 하는 화면**이다(2026-10-02) — 프로필 카드(240px)와 가로 탭바를 그 위에 두면
        가입 직후 도착한 작가의 첫 화면이 작품 올리기가 아니라 내 이메일이 된다. 다른 메뉴는 상단 [메뉴]·우측 사이드바로 간다.
      */}
      {!focused && !listTab && !adminWork && <ProfileCard />}

      {/*
        메뉴는 **lg(1024px) 이상에서만 우측 세로 사이드바**, 그 아래는 기존 가로 탭바.
        375px 폭에 224px 사이드바를 붙이면 본문이 150px밖에 안 남는다 — 좁은 화면에서는
        가로 스크롤 탭이 유일하게 쓸 만한 형태다(참고한 artspoon 도 좁아지면 사이드바를 접는다).
      */}
      <div className={cn('relative mb-8 lg:hidden', focused && 'hidden')}>
        <div ref={tabBarRef} className="flex gap-4 overflow-x-auto pb-2 border-b border-gray-200 scrollbar-hide">
          {tabs.map(tab => {
            const cls = `px-1 py-2 text-base font-medium whitespace-nowrap transition-colors cursor-pointer ${
              !tab.linkTo && currentTab === tab.id ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400 hover:text-gray-900'
            }`;
            // [홈페이지]는 탭이 아니라 공개 작가 페이지로 나가는 링크다 — 여기서 selectTab 하면 빈 화면이 된다
            const name = tab.brand
              ? <span className="font-bold tracking-tight font-serif">{tab.brand[0]}<span className="text-accent">{tab.brand[1]}</span></span>
              : tab.label;
            const badge = badgeCount(adminTodo, tab.badge);
            const label = badge != null ? <span className="inline-flex items-center gap-1.5">{name}<MenuBadge count={badge} /></span> : name;
            return tab.linkTo ? (
              <Link key={tab.id} to={tabHref(tab, user.id, user.role)} className={cls}>{label}</Link>
            ) : (
              <button key={tab.id} onClick={() => selectTab(tab.id)} className={cls}>{label}</button>
            );
          })}
        </div>
        {/* 우측 스크롤 힌트 (클릭 차단 방지 위해 pointer-events-none 필수) */}
        {tabOverflowRight && (
          <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none" />
        )}
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        <div className="min-w-0">
          {/* 홈페이지에 남은 일 — **[프로필] 탭에만, 한 줄**(2026-10-02 사용자 결정). 다 채우면 스스로 사라진다.
              예전엔 상자가 프로필·포트폴리오·ArtLook 세 탭 위에 붙어 있었다 — 로그인 팝업과 같은 말을 두 번 했고,
              PDF 를 만들러 온 [포트폴리오] 탭에서는 본 내용을 밀어냈다. 편집 화면은 제 완성도 줄을 갖는다(HomepageEditor). */}
          {user.role === 'ARTIST' && currentTab === 'profile' && <ArtistHomepageLine />}
          {currentTab === 'profile' && <><ProfileSection /><BlockedUsersSection /></>}
          {/* 홈페이지 편집 — 메뉴에 없다. 공개 작가 페이지의 [수정](주인만)에서 들어온다 */}
          {currentTab === 'homepage-edit' && user.role === 'ARTIST' && <HomepageEditor />}
          {/* 포트폴리오 PDF 만들기 — 화면은 `components/portfolio-maker/`(2026-10-03 개편) */}
          {currentTab === 'portfolio' && user.role === 'ARTIST' && <PortfolioMaker />}
          {currentTab === 'artlook' && user.role === 'ARTIST' && <ArtLookSection />}
          {currentTab === 'favorites' && (user.role === 'ARTIST' || user.role === 'VISITOR') && <FavoritesSection />}
          {currentTab === 'scraps' && user.role === 'GALLERY' && <ArtworkScrapsSection />}
          {currentTab === 'received-inquiries' && (user.role === 'ARTIST' || user.role === 'GALLERY') && <ReceivedInquiriesSection />}
          {currentTab === 'applications' && user.role === 'ARTIST' && <ApplicationsSection />}
          {currentTab === 'my-galleries' && user.role === 'GALLERY' && <MyGalleriesSection />}
          {currentTab === 'my-exhibitions' && user.role === 'GALLERY' && <MyExhibitionsSection />}
          {currentTab === 'my-shows' && user.role === 'GALLERY' && <MyShowsSection />}
          {currentTab === 'stats' && user.role === 'ADMIN' && <AdminStatsSection />}
          {currentTab === 'approvals' && user.role === 'ADMIN' && <ApprovalsSection />}
          {currentTab === 'hosted-exhibitions' && user.role === 'ADMIN' && <HostedExhibitionsSection />}
          {currentTab === 'hero-manage' && user.role === 'ADMIN' && <HeroManageSection />}
          {currentTab === 'gotm-manage' && user.role === 'ADMIN' && <GotmManageSection />}
          {currentTab === 'ad-manage' && user.role === 'ADMIN' && <AdManageSection />}
          {/* 소식 신고(ArtStory, 2026-11-14) 가 위 — 저절로 내려간 소식을 확인해 달라는 알림이 여기로 온다 */}
          {currentTab === 'report-manage' && user.role === 'ADMIN' && <><ChatReportsSection /><StoryReportsSection /></>}
          {currentTab === 'user-manage' && user.role === 'ADMIN' && <UserManageSection />}
          {currentTab === 'oversight' && user.role === 'ADMIN' && <OversightSection />}
          {currentTab === 'todo' && user.role === 'ADMIN' && <KanbanSection />}
          {currentTab === 'dev-tools' && user.role === 'ADMIN' && <DevToolsSection />}
        </div>

        {/* 우측 세로 메뉴는 여기 없다 — Layout 의 <MyPageSideMenu/> 가 전 페이지에 띄운다.
            여기에도 두면 마이페이지에서만 메뉴가 두 개로 보인다. */}
      </div>
    </div>
  );
}

// ========== 프로필 카드 (프로필 사진 변경 포함) ==========
function ProfileCard() {
  const { user, updateUser } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarDrag, setAvatarDrag] = useState(false);

  const handleAvatarUpload = async (rawFile: File) => {
    setUploading(true);
    try {
      const avatarUrl = await uploadAvatar(rawFile);
      updateUser({ avatar: avatarUrl });
      toast.success('프로필 사진이 변경되었습니다.');
    } catch (e) {
      toast.error(e instanceof Error && e.message.startsWith('이미지 용량') ? e.message : '프로필 사진 변경에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const roleBadgeClass = user?.role === 'ARTIST'
    ? 'bg-gray-200 text-gray-700'
    : user?.role === 'GALLERY'
    ? 'bg-green-100 text-green-700'
    : 'bg-accent/10 text-accent';

  return (
    <div className="bg-gray-50 rounded-2xl p-6 mb-6 min-h-[180px] md:min-h-[240px] flex items-center">
      <div className="flex items-center gap-4">
        <div
          className="relative group"
          onDragOver={(e) => { e.preventDefault(); setAvatarDrag(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAvatarDrag(false); }}
          onDrop={(e) => { e.preventDefault(); setAvatarDrag(false); const f = Array.from(e.dataTransfer.files).find(file => file.type.startsWith('image/')); if (f) handleAvatarUpload(f); }}
        >
          {/* 320px 미만(갤럭시 폴드 커버화면)에서만 축소 — 96px 아바타가 남은 폭을 다 먹어
              글꼴 크게 설정과 겹치면 카드가 화면을 밀어낸다. 일반 폰(360px+)의 모양은 그대로 둔다. */}
          <div className={`w-24 h-24 max-[320px]:w-16 max-[320px]:h-16 bg-gray-200 rounded-full flex items-center justify-center text-3xl font-bold text-gray-400 overflow-hidden ${avatarDrag ? 'ring-2 ring-gray-500 ring-offset-2' : ''}`}>
            {user?.avatar ? (
              <img src={user.avatar} alt={`${displayName(user)} 프로필 사진`} className="w-full h-full object-cover" />
            ) : (
              displayName(user).charAt(0)
            )}
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-label="프로필 사진 변경"
            className={`absolute inset-0 bg-black/40 rounded-full flex items-center justify-center transition-opacity ${avatarDrag ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <Camera size={20} className="text-white" />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarUpload(file);
              e.target.value = '';
            }}
          />
        </div>
        {/* min-w-0 필수 — 없으면 flex 자식이 min-content 아래로 못 줄어든다.
            이메일은 공백 없는 한 덩어리라 그대로 카드를 밀어내고, 마이페이지는 프로필 카드가
            모든 탭 공통이라 **페이지 전체가 가로로 넓어진다**(갤럭시 폴드 280px, 글꼴 크게 설정에서 실측).
            그러면 화면이 좌우로 흔들리고 오른쪽이 잘려 보인다 — 가로모드에선 폭이 남아 멀쩡해 보인다. */}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold truncate">{displayName(user)}</h2>
          {user?.nickname && <p className="text-xs text-gray-400 truncate">{user.name}</p>}
          <p className="text-sm text-gray-500 break-all">{user?.email}</p>
          <span className={`inline-block mt-1 px-2.5 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`}>{roleLabel(user?.role)}</span>
        </div>
      </div>
    </div>
  );
}

// ========== 프로필 섹션 ==========
function ProfileSection() {
  const { user, updateUser } = useAuthStore();
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkResult, setCheckResult] = useState<{ available: boolean; reason?: string } | null>(null);

  // 연락처/이메일/인스타 (작가·관람객) — /auth/me로 최신값 하이드레이트. 홈페이지 주소는 작가만.
  const isArtist = user?.role === 'ARTIST';
  const canEditContact = isArtist || user?.role === 'VISITOR';
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [instagram, setInstagram] = useState(user?.instagramUrl ?? '');
  const [savingContact, setSavingContact] = useState(false);
  // 홈페이지 주소(@handle, 2026-09-16) — 비어 있으면 인스타 아이디를 제안한다(공개 페이지가 열릴 때 서버도 같은 값을 자동으로 만든다)
  // 입력·중복확인은 `HomepageAddressField`(홈페이지 편집 › [꾸미기] 와 같은 칸)가 한다. 여기서는 저장만.
  const [handleInput, setHandleInput] = useState(user?.handle ?? '');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [savingHandle, setSavingHandle] = useState(false);

  useEffect(() => {
    if (!canEditContact) return;
    api.get('/auth/me').then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setEmail(u.email ?? '');
      setPhone(u.phone ?? '');
      setInstagram(u.instagramUrl ?? '');
      setHandleInput(u.handle ?? '');
      updateUser({ email: u.email, phone: u.phone, instagramUrl: u.instagramUrl, handle: u.handle ?? null });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditContact]);

  const handleNorm = normalizeHandle(handleInput);
  const handleReason = handleNorm ? validateHandle(handleNorm) : null;
  const handleUnchanged = handleNorm === (user?.handle ?? '');
  const handleSuggestion = suggestHandle(instagram || user?.instagramUrl);
  const saveHandle = async () => {
    if (handleReason) { toast.error(handleReason); return; }
    setSavingHandle(true);
    try {
      const res = await api.put('/auth/me/handle', { handle: handleNorm });
      updateUser({ handle: res.data.handle });
      setHandleInput(res.data.handle);
      setHandleError(null);
      toast.success('홈페이지 주소가 저장되었습니다.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '저장에 실패했습니다.';
      setHandleError(msg);
      toast.error(msg);
    } finally { setSavingHandle(false); }
  };

  const contactChanged =
    email.trim() !== (user?.email ?? '') ||
    phone.trim() !== (user?.phone ?? '') ||
    instagram.trim() !== (user?.instagramUrl ?? '');

  const handleSaveContact = async () => {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('유효한 이메일을 입력해주세요.');
      return;
    }
    // 인스타: 스킴 없으면 https:// 보정해 저장
    let ig = instagram.trim();
    if (ig && !/^https?:\/\//i.test(ig)) ig = `https://${ig}`;
    setSavingContact(true);
    try {
      const { data } = await api.put('/auth/me/profile', { email: trimmedEmail, phone: phone.trim(), instagramUrl: ig });
      updateUser({ email: data.email, phone: data.phone, instagramUrl: data.instagramUrl });
      setInstagram(data.instagramUrl ?? '');
      toast.success('내 정보가 저장되었습니다.');
    } catch (err: any) {
      if (err?.response?.status === 409) toast.error('이미 사용 중인 이메일입니다.');
      else toast.error(err?.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSavingContact(false);
    }
  };

  const trimmed = nickname.trim();
  const unchanged = trimmed === (user?.nickname ?? '');
  const validLength = trimmed.length >= 2 && trimmed.length <= 20;

  const handleCheck = async () => {
    if (!validLength) {
      setCheckResult({ available: false, reason: '닉네임은 2~20자로 입력해주세요.' });
      return;
    }
    setChecking(true);
    try {
      const res = await api.get('/auth/nickname-check', { params: { nickname: trimmed } });
      setCheckResult(res.data);
    } catch {
      toast.error('중복 확인에 실패했습니다.');
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => {
    if (!validLength) {
      toast.error('닉네임은 2~20자로 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.put('/auth/me/nickname', { nickname: trimmed });
      updateUser({ nickname: res.data.nickname });
      setCheckResult(null);
      toast.success('닉네임이 저장되었습니다.');
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setCheckResult({ available: false, reason: '이미 사용 중인 닉네임입니다.' });
        toast.error('이미 사용 중인 닉네임입니다.');
      } else {
        toast.error(err?.response?.data?.error || '닉네임 저장에 실패했습니다.');   // 서버는 `{ error }` 로만 내려준다(감사 M1)
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md space-y-6 py-2">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">닉네임</label>
        <p className="text-xs text-gray-400 mb-2">(2~20자)</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); setCheckResult(null); }}
            maxLength={20}
            placeholder="닉네임을 입력하세요"
            className="min-w-0 flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <button
            onClick={handleCheck}
            disabled={checking || !validLength || unchanged}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            중복확인
          </button>
        </div>
        {checkResult && (
          <p className={`text-xs mt-1.5 ${checkResult.available ? 'text-green-600' : 'text-accent'}`}>
            {checkResult.available ? '사용 가능한 닉네임입니다.' : (checkResult.reason || '이미 사용 중인 닉네임입니다.')}
          </p>
        )}
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !validLength || unchanged}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? '저장 중...' : '닉네임 저장'}
      </button>

      {/* 홈페이지 주소 (작가 전용, 2026-09-16) — 인스타 프로필·명함·QR 에 적을 주소 */}
      {isArtist && (
        <div className="pt-5 border-t border-gray-100 space-y-2">
          <label htmlFor="profile-handle" className="block text-sm font-medium text-gray-700">홈페이지 주소</label>
          <p className="text-xs text-gray-400">영문 소문자·숫자·마침표·밑줄, 3~30자. 인스타그램 아이디를 그대로 쓰면 기억하기 쉽습니다.</p>
          <HomepageAddressField
            inputId="profile-handle"
            value={handleInput}
            onChange={(v) => { setHandleInput(v); setHandleError(null); }}
            current={user?.handle}
            suggestion={handleSuggestion}
            error={handleError}
          />
          <button
            onClick={saveHandle}
            disabled={savingHandle || !handleNorm || handleUnchanged || !!handleReason}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {savingHandle ? '저장 중...' : '주소 저장'}
          </button>
        </div>
      )}

      {/* 연락처 / 인스타 (작가·관람객) */}
      {canEditContact && (
        <div className="pt-5 border-t border-gray-100 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-700">내 정보</h3>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1"><Mail size={14} className="text-gray-400" /> 이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1"><Phone size={14} className="text-gray-400" /> 전화번호</label>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              placeholder="010-1234-5678"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1"><Instagram size={14} className="text-gray-400" /> 인스타그램 주소</label>
            <input
              type="text"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="instagram.com/your_id"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <button
            onClick={handleSaveContact}
            disabled={savingContact || !contactChanged}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Save size={14} /> {savingContact ? '저장 중...' : '내 정보 저장'}
          </button>
        </div>
      )}

      {/* 회원 탈퇴는 여기 없다 — 고객센터(SupportPage) 우측 하단으로 옮겼다 */}
    </div>
  );
}

// ========== Artist: ArtLook (액자 걸기) ==========
/**
 * 내 작품을 액자·전시 공간에 걸어 SNS 홍보 이미지를 만드는 도구.
 *
 * 화면은 `/artlook/index.html`(정적 페이지, 화면 코드는 같은 폴더의 ui.js)을 **이 탭 안 iframe** 으로 품는다.
 * 작품 목록은 localStorage 로 넘긴다(`lib/artlook.ts`) — 같은 출처라 iframe 안에서도 그대로 읽힌다.
 *
 * 2026-10-04 개편(CLAUDE.md 규칙 65): 프로필 카드·탭 줄 없이(`focused`) **상단바 아래부터 하단 탭바 위까지** 화면 전체를 쓴다.
 * 예전엔 프로필 카드 밑 y436 에서 시작해 휴대폰 첫 화면에 미리보기가 0px 였다. 높이는 상자의 실제 위치로 잰다(useFillHeight).
 * iframe 과는 postMessage 로 이야기한다 — [작품 올리기]/[크기 입력하기] → 편집 화면, [ArtStory에 올리기] → 올리고 글쓰기 칸.
 * ⚠️ 보낸 쪽은 **이 iframe 의 창**이고 같은 출처여야 한다 — 다른 창이 보낸 말로 페이지를 옮기거나 올리면 안 된다.
 */
function ArtLookSection() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const bare = useArtLookBare();
  const { data: portfolio, isLoading } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then(r => r.data),
  });
  const images = useMemo(() => portfolio?.images ?? [], [portfolio]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 아이폰 SE(568px)도 하단 탭바 위에서 끝나게 — 그보다 낮은 화면(가로로 눕힌 휴대폰)은 바깥 페이지가 스크롤된다
  // 편집 전용 화면(휴대폰)은 아래에 띄울 여백도 없다 — 화면 바닥까지
  const height = useFillHeight(boxRef, { min: 340, gap: bare ? 0 : 24 });

  /*
    작품 목록을 **iframe 을 그리기 전에** localStorage 에 올려둔다 —
    ArtLook 은 뜰 때 한 번만 읽으므로 순서가 뒤바뀌면 빈 화면이 된다.
    넘긴 내용의 지문이 iframe 의 key — 예전엔 '개수'라 제목·치수를 고치거나 한 장을 지우고 한 장을 올리면
    개수가 같아 재마운트되지 않았고, ArtLook 은 옛 목록을 계속 썼다(감사 M5).
  */
  const stagedKey = useMemo(() => {
    const works = portfolioArtLookWorks(images, displayName(user));
    stageArtLookWorks(works);   // 0점이면 저장분을 비워 ArtLook 이 데모 작품을 띄운다(규칙 36)
    return works.map(w => `${w.id}|${w.url}|${w.title ?? ''}|${w.sizeText ?? ''}`).join('\n');
  }, [images, user]);

  useEffect(() => {
    const send = (data: object) => frameRef.current?.contentWindow?.postMessage(data, window.location.origin);
    const toStory = async (blob: Blob, name: string) => {
      const id = toast.loading('ArtStory에 올릴 이미지를 준비하고 있어요…');
      try {
        const form = new FormData();
        form.append('image', new File([blob], name, { type: blob.type || 'image/jpeg' }));
        const { data } = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.dismiss(id);
        // 소식 올리기 화면이 사진을 실은 채로 열린다(StoryComposePage 가 state 를 한 번 읽고 지운다, 2026-11-14)
        navigate('/story/new', { state: { [COMPOSE_STATE_KEY]: [data.url], from: '/mypage?tab=artlook' } });
      } catch (err) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error(msg || '이미지를 올리지 못했어요. 잠시 후 다시 해 보세요.', { id });
        send({ type: 'artlook:story-failed' });
      }
    };
    const onMessage = (e: MessageEvent) => {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win || e.origin !== window.location.origin) return;
      const msg = readArtLookMessage(e.data);
      if (!msg) return;
      if (msg.type === 'goto' && msg.to === 'close') {
        // [닫기 ×](휴대폰 편집 전용 화면) — 앱 안에서 온 길이 있으면 그리로(안드로이드 뒤로가기와 같은 곳), 없으면 마이페이지 첫 탭으로.
        // ⚠️ location.key 로 가르지 말 것 — 마이페이지 탭은 기록을 바꿔 끼우므로(replace) 주소로 바로 열고 탭만 바꿔도 key 가 'default' 가 아니다.
        //    그때 navigate(-1) 은 앱 밖(브라우저면 다른 사이트)으로 나간다(2026-11-18 에뮬레이터에서 잡았다). 상세 화면의 '뒤로'와 같은 판정을 쓴다.
        if ((window.history.state?.idx ?? 0) > 0) navigate(-1); else navigate('/mypage', { replace: true });
      } else if (msg.type === 'goto') navigate(msg.to === 'size' ? editHref('works', { info: true, work: msg.id }) : editHref('works'));
      else void toStory(msg.blob, msg.name);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  return (
    <div>
      {/* 제목 줄 — 화면 이름은 좌측 상단(로고 색 규칙). 휴대폰은 한 줄로.
          편집 전용 화면(휴대폰)은 ArtLook 이 제 머리에 이름을 그린다 — 여기는 화면 낭독기용으로만 남긴다(지우지 않는다: 화면 이름 규칙 · e2e 30) */}
      <div className={cn('flex min-w-0 items-baseline gap-2.5', bare ? 'sr-only' : 'px-4 py-2 sm:px-0 sm:pb-3 sm:pt-0')}>
        <h2 className="shrink-0 text-lg sm:text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900">
          Art<span className="text-accent">Look</span>
        </h2>
        <p className="min-w-0 truncate text-sm text-gray-500">작품을 액자와 공간에 걸어 SNS에 올릴 이미지를 만듭니다</p>
      </div>
      {/* 작품이 0점이어도 iframe 은 그린다 — ArtLook 이 데모 작품으로 체험하게 하고, 그 안에서 [작품 올리기]로 보낸다(규칙 36) */}
      <div
        ref={boxRef}
        style={height ? { height } : undefined}
        className={cn('h-[70vh] overflow-hidden bg-white', bare ? '' : 'border-y border-gray-200 sm:rounded-lg sm:border')}
      >
        {isLoading ? (
          <div className="h-full animate-pulse bg-gray-100" />
        ) : (
          <iframe
            ref={frameRef}
            key={stagedKey}
            src={ARTLOOK_EMBED_URL}
            title="ArtLook"
            /* 휴대폰 저장은 공유 창(Web Share) — 같은 출처라 기본으로 허용되지만 적어 둔다 */
            allow="web-share; clipboard-write"
            className="block h-full w-full"
          />
        )}
      </div>
    </div>
  );
}

// ========== Artist: 찜 목록 ==========
function FavoritesSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // '작품'(좋아요한 작품)도 여기서 본다 — 예전엔 별도 탭이었는데 '모아둔 것'이라는 성격이 같아 합쳤다.
  const [filter, setFilter] = useState<'all' | 'gallery' | 'exhibition' | 'show' | 'artwork'>('all');

  const { data: favorites = [] } = useQuery<Favorite[]>({
    queryKey: ['favorites'],
    queryFn: () => api.get('/favorites').then(r => r.data),
  });

  // 찜 해제 - 낙관적 업데이트 + 교차 캐시 직접 수정 (stale 깜빡임 방지)
  const removeFav = useMutation({
    mutationFn: (data: { galleryId?: number; exhibitionId?: number; showId?: number }) => api.post('/favorites/toggle', data),
    onMutate: async (data) => {
      // 1) 찜 목록 캐시에서 즉시 제거
      await queryClient.cancelQueries({ queryKey: ['favorites'] });
      const prev = queryClient.getQueryData<Favorite[]>(['favorites']);
      if (prev) {
        queryClient.setQueryData(['favorites'],
          prev.filter(f => {
            if (data.galleryId) return f.galleryId !== data.galleryId;
            if (data.exhibitionId) return f.exhibitionId !== data.exhibitionId;
            if (data.showId) return f.showId !== data.showId;
            return true;
          })
        );
      }
      // 2) 갤러리/공모 목록 캐시에서도 isFavorited 즉시 false로 설정
      //    (페이지 이동 시 stale 캐시에 하트가 잠깐 보이는 현상 방지)
      if (data.galleryId) {
        queryClient.setQueriesData<Gallery[]>(
          { queryKey: ['galleries'], exact: false },
          (old) => old?.map(g => g.id === data.galleryId ? { ...g, isFavorited: false } : g)
        );
        queryClient.setQueriesData<any>(
          { queryKey: ['gallery'], exact: false },
          (old: any) => old?.id === data.galleryId ? { ...old, isFavorited: false } : old
        );
      }
      if (data.exhibitionId) {
        queryClient.setQueriesData<Exhibition[]>(
          { queryKey: ['exhibitions'], exact: false },
          (old) => old?.map(ex => ex.id === data.exhibitionId ? { ...ex, isFavorited: false } : ex)
        );
        queryClient.setQueriesData<any>(
          { queryKey: ['exhibition'], exact: false },
          (old: any) => old?.id === data.exhibitionId ? { ...old, isFavorited: false } : old
        );
      }
      if (data.showId) {
        queryClient.setQueriesData<Show[]>(
          { queryKey: ['shows'], exact: false },
          (old) => old?.map(s => s.id === data.showId ? { ...s, isFavorited: false } : s)
        );
        queryClient.setQueriesData<any>(
          { queryKey: ['show'], exact: false },
          (old: any) => old?.id === data.showId ? { ...old, isFavorited: false } : old
        );
      }
      return { prev };
    },
    onError: (_err, _data, context) => {
      // rollback: 찜 목록만 복원 (다른 캐시는 onSettled에서 refetch)
      if (context?.prev) queryClient.setQueryData(['favorites'], context.prev);
      toast.error('찜 해제에 실패했습니다.');
    },
    onSuccess: () => {
      toast.success('찜이 해제되었습니다.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibition'] });
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['show'] });
    },
  });

  const filtered = favorites.filter(f => {
    if (filter === 'gallery') return !!f.galleryId;
    if (filter === 'exhibition') return !!f.exhibitionId;
    if (filter === 'show') return !!f.showId;
    return true;
  });

  return (
    <div>
      {/* 화면 이름 — ArtLink 로고와 같은 색 규칙(My 검정 + Picks 빨강). 좌측 상단(PortFolio 등과 동일). */}
      <h2 className="mb-6 text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900">
        My <span className="text-accent">Picks</span>
      </h2>

      <div className="flex flex-wrap gap-4 mb-6">
        {(['all', 'gallery', 'exhibition', 'show', 'artwork'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-base cursor-pointer transition-colors ${filter === f ? 'text-gray-900 underline underline-offset-4 decoration-1' : 'text-gray-400 hover:text-gray-900'}`}>
            {f === 'all' ? '전체' : f === 'gallery' ? '갤러리' : f === 'exhibition' ? '공모' : f === 'show' ? '전시' : '작품'}
          </button>
        ))}
      </div>

      {/* '전체' 에서는 찜한 항목 아래에 좋아요한 작품을 이어 붙인다 — 성격이 달라 격자를 따로 둔다
          (찜은 갤러리/공모/전시 카드, 작품은 정사각 썸네일 + 확대 모달) */}
      {filter === 'artwork' ? <LikedArtworks /> : (<>

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-center py-8">찜한 항목이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(fav => {
            const img = fav.gallery?.mainImage || fav.show?.posterImage || null;
            const title = fav.gallery?.name || fav.exhibition?.title || fav.show?.title || '';
            const sub = fav.exhibition?.gallery?.name || fav.show?.gallery?.name || null;
            const link = fav.galleryId ? `/galleries/${fav.galleryId}` : fav.exhibitionId ? `/exhibitions/${fav.exhibitionId}` : `/shows/${fav.showId}`;

            return (
              <div key={fav.id} className="group cursor-pointer" onClick={() => navigate(link)}>
                {img && (
                  <div className="overflow-hidden mb-3">
                    <img src={img} alt={title} loading="lazy" className="w-full aspect-[4/3] object-cover group-hover:opacity-80 transition-opacity duration-300" />
                  </div>
                )}
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-base font-medium text-gray-900 hover:underline underline-offset-2 decoration-1">{title}</h4>
                    {sub && <p className="text-sm text-gray-400 mt-0.5">{sub}</p>}
                    {/* 리뷰 개수 — 별점을 없앤 자리(2026-09-10). 갤러리 찜에만 해당된다 */}
                    {fav.gallery && (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-sm text-gray-400">
                          {(fav.gallery.reviewCount ?? 0) > 0 ? `리뷰 ${fav.gallery.reviewCount}개` : '아직 리뷰 없음'}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFav.mutate({ galleryId: fav.galleryId || undefined, exhibitionId: fav.exhibitionId || undefined, showId: fav.showId || undefined }); }}
                    aria-label="찜 해제"
                    className="p-1 text-accent hover:text-[#a02620] cursor-pointer flex-none"
                  >
                    <Heart size={16} className="fill-current" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filter === 'all' && (
        <div className="mt-10 pt-8 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-500 mb-4">좋아요한 작품</p>
          <LikedArtworks />
        </div>
      )}
      </>)}
    </div>
  );
}

// ========== Artist: 좋아요한 작품 (참여 동기 ① — 누른 게 나에게 남는다) ==========
// 좋아요는 지금까지 눌러도 회수할 방법이 없었다. 모아 보여줘야 "다시 볼 것"으로서 의미가 생긴다.
// 작가가 공개를 내린 작품은 서버에서 제외된다(작가 선택 존중).
function LikedArtworks() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExploreImage | null>(null);
  const { data, isLoading } = useQuery<{ images: ExploreImage[]; total: number }>({
    queryKey: ['my-likes'],
    queryFn: () => api.get('/explore/my-likes', { params: { limit: 60 } }).then(r => r.data),
  });

  if (isLoading) return <p className="text-gray-400 py-10 text-center">불러오는 중…</p>;
  const images = data?.images ?? [];

  if (images.length === 0) {
    return (
      <div className="text-center py-16">
        <Heart size={32} className="mx-auto text-gray-200 mb-3" />
        <p className="text-gray-400 mb-4">아직 좋아요한 작품이 없습니다.</p>
        <button onClick={() => navigate('/artists')} className="text-sm text-gray-900 underline underline-offset-4 cursor-pointer">
          둘러보기에서 작품 보기
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-400 mb-4">{data?.total ?? images.length}점</p>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
        {images.map(img => (
          <div key={img.id} className="relative aspect-square overflow-hidden group">
            {/* 작품 클릭 → 원본 비율 확대 (둘러보기와 동일) */}
            <button
              onClick={() => setSelected(img)}
              className="absolute inset-0 w-full h-full cursor-pointer"
              aria-label="작품 크게 보기"
            >
              <Thumb src={img.url} size="grid" alt="" className="w-full h-full object-contain bg-gray-50" loading="lazy" />
            </button>
            <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
            {/* 작가 이름 클릭 → 작가 포트폴리오 */}
            <button
              onClick={() => navigate(`/portfolio/${img.artist.id}`)}
              className="absolute bottom-1 left-1.5 right-1.5 text-[11px] text-white/90 truncate text-left hover:underline cursor-pointer"
            >
              {displayName(img.artist)}
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {selected && (
          <ArtworkDetailModal image={selected} onClose={() => setSelected(null)} onUpdate={setSelected} />
        )}
      </AnimatePresence>
    </div>
  );
}


// ========== Gallery: 관심 작품 (하트로 모은 작품) ==========
/*
  갤러리도 **하트(좋아요)** 로 작품을 모은다(예전의 비공개 스크랩·메모 보드는 없앴다).
  ⚠️ 하트는 작가에게 보인다(스크랩과 달리 비공개가 아니다) — 관심을 숨길 이유가 없다는 판단.
  데이터는 작가 [찜 목록]의 '좋아요한 작품'과 같은 `/explore/my-likes` 를 쓴다.
  ⚠️ 카드의 [전시 초대]는 2026-11-19 에 없앴다(1:1 공모 초대 기능째로 — 사용자 결정). [문의하기]도 두지 않는다(사용자 결정 —
     작가 이름을 누르면 홈페이지로 가고, 거기서 문의한다). 카드는 작품 + 작가 이름뿐이다.
*/
function ArtworkScrapsSection() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExploreImage | null>(null);

  const { data, isLoading } = useQuery<{ images: ExploreImage[]; total: number }>({
    queryKey: ['my-likes'],
    queryFn: () => api.get('/explore/my-likes', { params: { limit: 60 } }).then(r => r.data),
  });

  if (isLoading) return <p className="text-gray-400 py-10 text-center">불러오는 중…</p>;
  const images = data?.images ?? [];

  if (images.length === 0) {
    return (
      <div className="text-center py-16">
        <Heart size={32} className="mx-auto text-gray-200 mb-3" />
        <p className="text-gray-400 mb-4">하트를 누른 작품이 없습니다.</p>
        <button onClick={() => navigate('/artists')} className="text-sm text-gray-900 underline underline-offset-4 cursor-pointer">
          둘러보기에서 작가 찾기
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {images.map(img => (
          <div key={img.id} className="relative border border-gray-200">
            {/* 이미지 클릭 → 원본 비율 확대 (작가 이동은 아래 이름 클릭) */}
            <button
              onClick={() => setSelected(img)}
              className="block w-full aspect-square overflow-hidden cursor-pointer"
              aria-label="작품 크게 보기"
            >
              <Thumb src={img.url} size="grid" alt="" className="w-full h-full object-contain bg-gray-50 hover:opacity-80 transition-opacity" loading="lazy" />
            </button>
            <button
              onClick={() => navigate(`/portfolio/${img.artist.id}`)}
              className="block w-full min-h-[44px] truncate px-3 text-left text-sm font-medium text-gray-900 hover:underline cursor-pointer"
            >
              {displayName(img.artist)}
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {selected && (
          <ArtworkDetailModal image={selected} onClose={() => setSelected(null)} onUpdate={setSelected} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ========== Artist: 내 전시 (지원 → 선정 → 출품 자료 → 전시 → 정산) ==========
// 분류 규칙은 lib/myExhibitions.ts, 단계·상태 이름과 할 일은 lib/flowLabels.ts
// 2026-11-20(규칙 88): 카드 → 줄. 전시를 누르면 본문 전체가 그 전시 화면(`components/workspace/ArtistExhibitionWorkspace`)이다.
function ApplicationsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1024px)');
  // null = 아직 자동 선택 전. 데이터가 온 뒤 '내용이 있는 첫 탭'으로 한 번만 정한다
  const [statusFilter, setStatusFilter] = useState<MyExhibitionBucket | null>(null);
  /** 열린 전시 — 주소 `?ex=<공모 id>`(알림·초대 코드·공모 상세가 이 주소로 보낸다) */
  const exId = Number(searchParams.get('ex')) || null;
  const navState = (location.state ?? {}) as { fromList?: boolean; view?: string };

  const { data: apps = [], isLoading, isError, isFetched: appsFetched } = useQuery<any[]>({
    queryKey: ['my-applications'],
    queryFn: () => api.get('/exhibitions/my-applications').then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 사용자가 고른 탭은 refetch 가 되돌리면 안 된다 — 그래서 한 번만 정한다(목록이 온 뒤에, 렌더 중 상태 맞추기)
  if (statusFilter === null && appsFetched && apps.length > 0) setStatusFilter(defaultBucket(apps));

  // 알림으로 바로 들어왔으면 돌아갈 목록 탭을 그 전시가 있는 탭으로(렌더 중 상태 맞추기 — 한 번만)
  const [placedFor, setPlacedFor] = useState<number | null>(null);
  if (exId && apps.length > 0 && placedFor !== exId) {
    setPlacedFor(exId);
    const target = apps.find((a: any) => a.exhibitionId === exId);
    if (target) setStatusFilter(bucketOf(target));
  }

  const openExhibition = (exhibitionId: number, view?: string | null) => {
    rememberListScroll('applications');
    navigate(`/mypage?tab=applications&ex=${exhibitionId}`, { state: { fromList: true, view: view ?? undefined } });
  };
  // 목록에서 왔으면 뒤로(앱 뒤로가기와 같다), 바로 들어왔으면 목록으로 갈아 끼운다 — 기록이 쌓이지 않게
  // ⚠️ 저장 안 된 입력을 버리고 닫을 땐 갈아 끼운다 — 그 화면이 쌓아 둔 가드 항목(useUnsavedChanges)을 뒤로 지나가면 한 번 더 묻는다
  const closeExhibition = () => {
    if (navState.fromList && !hasUnsavedChanges()) navigate(-1);
    else navigate('/mypage?tab=applications', { replace: true });
  };
  useLayoutEffect(() => {
    if (exId) return;
    const y = takeListScroll('applications');
    // 즉시 — html 의 scroll-behavior: smooth 를 그대로 타면 목록 맨 위에서 보던 자리까지 1.5초를 굴러 내려갔다(2026-11-20 LST-07, 공모 92개 실측)
    if (y != null) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  }, [exId]);

  // 거절 확인 — '확인'을 눌러야 목록에서 제거 (그전까지는 '심사 중' 탭에 남는다)
  const ackRejectionMutation = useMutation({
    mutationFn: (appId: number) => api.post(`/exhibitions/applications/${appId}/acknowledge-rejection`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['my-applications'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '처리에 실패했습니다.'),
  });
  // 보내는 중인 지원은 다시 보내지 않는다 — 줄이 목록에서 빠지기 전(다시 받는 동안) 또 누르면 요청이 또 갔다(e2e 90 ART-03)
  const acking = useRef(new Set<number>());
  const ackRejection = (appId: number) => {
    if (acking.current.has(appId)) return;
    acking.current.add(appId);
    ackRejectionMutation.mutate(appId, { onSettled: () => { acking.current.delete(appId); } });
  };

  if (exId) {
    const v = navState.view as ArtistView | undefined;
    return <ArtistExhibitionWorkspace key={exId} exhibitionId={exId} initialView={v ?? null} onClose={closeExhibition} />;
  }

  if (isError) {
    return <p className="py-8 text-center text-accent">내 전시 목록을 불러오는 중 오류가 발생했습니다.</p>;
  }
  if (isLoading) return <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />;

  // 거절을 '확인'한 지원만 숨김 (확인 전 거절은 목록에 표시 → 확인 버튼 노출)
  const visibleApps = apps.filter((a: any) => !(isRejected(a) && a.rejectionAckedAt));
  const buckets = groupMyExhibitions(visibleApps);
  const activeTab: MyExhibitionBucket = statusFilter ?? defaultBucket(visibleApps);
  const filteredApps = buckets[activeTab];
  const counts: Record<MyExhibitionBucket, number> = {
    REVIEWING: buckets.REVIEWING.length,
    ONGOING: buckets.ONGOING.length,
    CLOSED: buckets.CLOSED.length,
  };
  const empty = visibleApps.length === 0;

  // 초대 코드 입력은 드물게 쓰는 입구라 한 줄로 접어 둔다. 목록이 비어 있으면(코드를 받고 막 가입한 작가의 첫 화면) 펼쳐 둔다.
  const joinCode = (
    <Disclosure variant="link" title="초대 코드가 있나요?" defaultOpen={empty}>
      <div className="max-w-md pb-1">
        <p className="mb-2 text-xs text-gray-500">이미 선정된 공모라면 갤러리에게 받은 코드를 넣으세요. 지원서 없이 바로 참여해요.</p>
        <JoinCodeInput compact />
      </div>
    </Disclosure>
  );

  if (empty) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-gray-950">내 전시</h2>
        <div className="border-y border-gray-200 py-12 text-center">
          <p className="text-sm text-gray-600">아직 지원하거나 참여한 전시가 없어요.</p>
          <button type="button" onClick={() => navigate('/exhibitions')} className="mt-5 inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50">
            모집공고 보기 <ArrowRight size={14} aria-hidden />
          </button>
        </div>
        {joinCode}
      </div>
    );
  }

  const rowOf = (app: any) => {
    const ex = app.exhibition ?? {};
    const accepted = app.status === 'ACCEPTED';
    const stage = accepted ? stageOf(ex) : null;
    const snapshot: ArtistSnapshot = {
      status: app.status,
      recruitOnly: !!ex.recruitOnly,
      confirmed: !!ex.confirmed,
      ended: !!ex.ended,
      settled: !!ex.settledAt,
      settlementRequested: !!ex.settlementRequestedAt,
      submissionComplete: !!app.submissionComplete,
      submissionDeadline: ex.submissionDeadline,
      exhibitStartDate: ex.exhibitStartDate,
      mySettlementStatus: app.mySettlementStatus,
    };
    const task = artistNextTask(snapshot);
    const todo = accepted && task?.tone === 'attention';
    const rejected = app.status === 'REJECTED';
    return {
      todo,
      node: (
        <ExhibitionRow
          key={app.id}
          id={`app-card-${app.id}`}
          wide={wide}
          poster={ex.imageUrl}
          status={accepted ? (stage?.label ?? '선정') : applicationStatusView(app.status, 'artist').label}
          sub={artistSubText({
            stageKey: stage?.key ?? null, applicationStatus: app.status, appliedAt: app.createdAt,
            submissionComplete: !!app.submissionComplete, mySettlementStatus: app.mySettlementStatus,
            deadline: ex.deadline, submissionDeadline: ex.submissionDeadline, exhibitStartDate: ex.exhibitStartDate, exhibitDate: ex.exhibitDate,
            settledAt: ex.settledAt, settlementRequestedAt: ex.settlementRequestedAt,
          })}
          title={ex.title}
          meta={ex.gallery?.name || '아트링크'}
          strip={flowStrip('artist', { ...ex, applicationStatus: app.status, submissionComplete: !!app.submissionComplete, mySettlementStatus: app.mySettlementStatus })}
          task={todo ? task : { text: rejected ? '이번 공모에서는 선정되지 않았어요' : artistWaitText(snapshot), tone: 'neutral' }}
          actionLabel={todo ? task?.action : rejected ? '확인' : !accepted ? '지원서 보기' : undefined}
          onOpen={() => openExhibition(app.exhibitionId)}
          onAction={todo
            ? () => openExhibition(app.exhibitionId, task?.target === 'settlement' || task?.target === 'submissions' ? task.target : null)
            : rejected ? () => ackRejection(app.id)
              : !accepted ? () => openExhibition(app.exhibitionId) : undefined}
        />
      ),
    };
  };
  const rows = filteredApps.map(rowOf);
  const todoRows = activeTab === 'ONGOING' ? rows.filter(r => r.todo) : [];
  const restRows = activeTab === 'ONGOING' ? rows.filter(r => !r.todo) : rows;

  return (
    <div>
      <h2 className="text-2xl font-semibold text-gray-950">내 전시</h2>

      {/* 진행 상태 탭 — 심사 중 / 진행 중 / 종료 */}
      <div className="mt-3">
        <PageTabBar<MyExhibitionBucket>
          sticky={false}
          idPrefix="my-applications"
          label="내 전시 분류"
          active={activeTab}
          onSelect={(t) => setStatusFilter(t)}
          tabs={MY_EXHIBITION_TABS.map(t => ({ id: t.key, label: t.label, count: counts[t.key] || undefined }))}
        />
      </div>

      {filteredApps.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{MY_EXHIBITION_EMPTY[activeTab]}</p>
      ) : (
        <>
          {todoRows.length > 0 && (
            <>
              <RowGroupHead label="지금 할 일" count={todoRows.length} first />
              <ul>{todoRows.map(r => r.node)}</ul>
            </>
          )}
          {restRows.length > 0 && (
            <>
              {activeTab === 'ONGOING' && <RowGroupHead label="기다리는 중" count={restRows.length} first={todoRows.length === 0} />}
              <ul className={cn(activeTab !== 'ONGOING' && 'mt-2')}>{restRows.map(r => r.node)}</ul>
            </>
          )}
        </>
      )}

      <div className="mt-3">{joinCode}</div>
    </div>
  );
}

// ========== Gallery: 내 갤러리 ==========
// 삭제 이중확인 모달 — "삭제"를 입력해야 진행 (갤러리/공모/전시 공용)

function MyGalleriesSection({ createOnly = false }: { createOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const emptyForm = emptyGalleryForm;
  const [form, setForm] = useState<GalFormValues>(emptyForm);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | null>(null);
  // 미리보기(좁은 화면 — 하단 줄의 [미리보기])
  const [previewOpen, setPreviewOpen] = useState(false);
  const wideForm = useMediaQuery('(min-width: 1280px)');
  // 필수 항목 검증 하이라이트 (공모 등록 폼과 동일 패턴)
  const [galleryFormErrors, setGalleryFormErrors] = useState<Set<string>>(new Set());
  const clearGalleryError = (field: string) => setGalleryFormErrors(prev => {
    if (!prev.has(field)) return prev;
    const next = new Set(prev); next.delete(field); return next;
  });
  // 갤러리 삭제 이중확인 ("삭제" 입력)
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  // 직접 지울 수 없는 갤러리 — 관리자에게 삭제 요청(작가가 참여 중이거나 정산 기록이 있는 공모가 있으면, 서버 lib/deletion.ts)
  const [requestTarget, setRequestTarget] = useState<{ id: number; name: string; reason: string } | null>(null);
  const deleteRequestOf = useMyDeleteRequests();
  const askDeleteGallery = async (g: any) => {
    try {
      const blocked = await checkDeletable('gallery', g.id);
      if (blocked) setRequestTarget({ id: g.id, name: g.name, reason: blocked });
      else setDeleteTarget(g);
    } catch (e: any) {
      toast.error(e.response?.data?.error || '삭제할 수 있는지 확인하지 못했어요.');
    }
  };

  // 임시저장 훅
  const { pending: draftPending, savedAt: draftSavedAt, resume: resumeDraft, discard: discardDraft, save: saveDraft, clear: clearDraft, autoSave } = useFormDraft<GalFormValues>('draft_gallery_form');

  // 폼 변경 감지 (이탈 경고용)
  const isDirty = showForm && JSON.stringify(form) !== JSON.stringify(emptyForm);
  useUnsavedChanges(isDirty);

  // 폼 변경 시 자동저장
  useEffect(() => {
    if (showForm && isDirty) autoSave(form);
  }, [form, showForm, isDirty, autoSave]);

  // 폼 열기 — 작성하던 게 있으면 폼 위 안내(DraftNotice)에서 이어 쓸지 고른다(예전 window.confirm)
  const openForm = () => setShowForm(true);

  // 전용 등록 화면(/galleries/new)에서는 폼만 연 채로 시작한다(목록·헤더 숨김).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (createOnly) openForm(); }, [createOnly]);

  // ⚠️ `.catch(() => [])` 로 삼키지 말 것 — 서버 오류가 "등록된 갤러리가 없습니다"(성공한 빈 목록)로 둔갑한다(감사 M18)
  const { data: galleries = [], isError: galleriesError } = useQuery<any[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data),
  });

  const createMutation = useMutation({
    // 주소는 한 줄로 보낸다(주소 + 상세 주소) — 서버·이미 등록된 갤러리는 지금처럼 문자열 하나다
    mutationFn: ({ addressDetail: _detail, ...data }: GalFormValues) => api.post('/galleries', { ...data, address: fullAddress({ address: data.address, addressDetail: _detail }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      setShowForm(false);
      setForm(emptyForm);
      clearDraft();
      toast.success('갤러리 등록 요청이 제출되었습니다.');
      if (createOnly) navigate('/mypage?tab=my-galleries');   // 전용 화면에서 제출 후 내 갤러리 목록으로
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  // 갤러리 삭제 (승인 완료/거절 건) — 관련 공모·전시·리뷰 cascade 삭제
  const deleteGalleryMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/galleries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      queryClient.invalidateQueries({ queryKey: ['galleries'] });
      // 갤러리 삭제 시 하위 공모/전시가 cascade 삭제되므로 관련 캐시도 갱신
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-shows'] });
      queryClient.invalidateQueries({ queryKey: ['my-operation-overview'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      toast.success('갤러리가 삭제되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제에 실패했습니다.'),
  });

  const statusColors: Record<string, string> = { PENDING: 'bg-yellow-100 text-yellow-700', APPROVED: 'bg-green-100 text-green-700', REJECTED: 'bg-accent/10 text-accent' };
  const statusLabels: Record<string, string> = { PENDING: '승인 대기', APPROVED: '승인 완료', REJECTED: '승인 거절' };
  return (
    <div>
      {!createOnly && (
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm text-gray-400">Admin 승인 후 검색에 노출됩니다.</p>
          <button onClick={() => navigate('/galleries/new')} className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/5 transition-colors">
            <Plus size={14} /> 갤러리 등록
          </button>
        </div>
      )}

      {/* 등록 폼 — 왼쪽 입력 · 오른쪽 미리보기(1280px 이상), 아래 고정 줄. 약관은 [등록 요청] 확인 창 안(components/form/SubmitSheet) */}
      {showForm && (
        <div>
          {draftPending && (
            <div className="mb-6">
              <DraftNotice
                title="작성하던 갤러리 등록 요청이 있어요"
                summary={draftPending.data.name}
                savedAt={draftPending.savedAt}
                onResume={() => { const d = resumeDraft(); if (d) setForm({ ...emptyForm, ...d }); }}
                onDiscard={discardDraft}
              />
            </div>
          )}
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
            <div className="min-w-0 max-w-[720px]">
              <GalleryFormBody form={form} setForm={setForm} errors={galleryFormErrors} clearError={clearGalleryError} />
            </div>
            {wideForm && <PreviewAside preview={galleryPreview(form)} />}
          </div>
          <StickySubmitBar
            missing={galleryMissing(form)}
            onJump={jumpToField}
            savedAt={draftSavedAt}
            onSaveDraft={() => {
              if (saveDraft(form)) toast.success('임시저장했어요. 이 브라우저에 남아 있어요.');
              else toast.error(draftPending ? '작성하던 내용을 먼저 [이어서 쓰기] 또는 [새로 쓰기]로 정해 주세요.' : '임시저장하지 못했어요.');
            }}
            onPreview={wideForm ? undefined : () => setPreviewOpen(true)}
            onCancel={() => { if (isDirty) { setConfirmAction('cancel'); } else if (createOnly) { navigate(-1); } else { setShowForm(false); setGalleryFormErrors(new Set()); } }}
            submitLabel="등록 요청"
            onSubmit={() => {
              const missing = galleryMissing(form);
              if (missing.length > 0) {
                setGalleryFormErrors(new Set(missing.map((m) => m.key)));
                jumpToField(missing[0].key);
                return;
              }
              const emailError = galleryEmailError(form.email);
              if (emailError) { toast.error(emailError); return; }
              setConfirmAction('submit');
            }}
            pending={createMutation.isPending}
          />
          {previewOpen && !wideForm && <PreviewSheet preview={galleryPreview(form)} onClose={() => setPreviewOpen(false)} />}
        </div>
      )}

      {/* 등록 확인 — 무엇이 올라가는지 + 갤러리 등록 약관 동의 */}
      {confirmAction === 'submit' && (
        <SubmitSheet
          title="등록을 요청할까요?"
          rows={[
            ['갤러리', form.name],
            ['주소', `${fullAddress(form)} · ${regionLabels[form.region] ?? form.region}`],
            ['전화', form.phone],
            ['대표자', `${form.ownerName} (공개 안 함)`],
          ]}
          note="관리자가 확인하면 알림으로 알려 드려요. 승인 뒤에는 갤러리 홈페이지에서 사진·소개·연락처를 바로 고칠 수 있어요."
          terms={{ url: '/terms/gallery-registration.txt', label: '갤러리 등록 약관' }}
          confirmLabel="등록 요청"
          pending={createMutation.isPending}
          onConfirm={() => { setConfirmAction(null); createMutation.mutate(form); }}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {/* 취소 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="작성 취소"
        message={'작성 중인 내용이 있습니다. 정말 취소하시겠습니까?\n임시저장된 내용은 유지됩니다.'}
        confirmText="취소하기"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); setShowForm(false); setGalleryFormErrors(new Set()); if (createOnly) navigate(-1); }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* 갤러리 목록 (전용 등록 화면에서는 숨김) */}
      {!createOnly && (galleries.length === 0 && !showForm ? (
        <p className="text-gray-400 text-center py-8">{galleriesError ? '갤러리 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : '등록된 갤러리가 없습니다.'}</p>
      ) : (
        <div className="space-y-3">
          {galleries.map((g: any) => (
            <div
              key={g.id}
              className="p-4 border border-gray-100 rounded-xl"
            >
              <div
                className={`flex justify-between items-start ${g.status === 'APPROVED' ? 'cursor-pointer hover:opacity-70' : ''}`}
                onClick={() => g.status === 'APPROVED' && navigate(`/galleries/${g.id}`)}
              >
                <div>
                  <h3 className="font-medium">{g.name}</h3>
                  <p className="text-sm text-gray-500">{g.address}</p>
                  {g.status === 'APPROVED' && (
                    <p className="text-xs text-gray-500 mt-1">상세페이지 보기 →</p>
                  )}
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${statusColors[g.status] || ''}`}>
                  {statusLabels[g.status] || g.status}
                </span>
              </div>
              {g.status === 'REJECTED' && g.rejectReason && (
                <p className="text-sm text-accent mt-2">거절 사유: {g.rejectReason}</p>
              )}
              {/* 승인 완료/거절 건은 삭제 가능 (인스타 주소는 상세 페이지에서 추가/수정).
                  작가가 참여 중이거나 정산 기록이 있는 공모가 있으면 누를 때 서버가 막고 삭제 요청 창을 연다 */}
              {(g.status === 'APPROVED' || g.status === 'REJECTED') && (
                <div className="mt-3 pt-3 border-t border-gray-100" onClick={e => e.stopPropagation()}>
                  <DeleteRequestLine request={deleteRequestOf('gallery', g.id)} kind="gallery" />
                  {deleteRequestOf('gallery', g.id)?.status !== 'PENDING' && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => askDeleteGallery(g)}
                        disabled={deleteGalleryMutation.isPending}
                        className="flex min-h-[40px] items-center gap-1 text-xs text-gray-400 hover:text-accent disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 size={13} /> 갤러리 삭제
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <DeleteConfirmModal
        open={!!deleteTarget}
        name={deleteTarget?.name ?? ''}
        description="갤러리를 삭제하면 등록된 공모·전시·리뷰도 함께 삭제되며 되돌릴 수 없습니다. 지원한 작가에게 삭제 알림이 가요."
        pending={deleteGalleryMutation.isPending}
        onConfirm={() => { deleteGalleryMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <DeleteRequestDialog
        open={!!requestTarget}
        kind="gallery"
        targetId={requestTarget?.id ?? 0}
        name={requestTarget?.name ?? ''}
        blockedReason={requestTarget?.reason ?? ''}
        onClose={() => setRequestTarget(null)}
      />

    </div>
  );
}

// ========== Gallery: 내 공모 ==========
function MyExhibitionsSection({ initialViewMode, createOnly = false }: { initialViewMode?: ExhibitionViewMode; createOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const wideList = useMediaQuery('(min-width: 1024px)');
  const [showForm, setShowForm] = useState(false);
  // 전용 등록 화면(/exhibitions/new)에서는 폼만 연 채로 시작한다.
  useEffect(() => { if (createOnly) setShowForm(true); }, [createOnly]);
  // 항상 '진행 중'으로 시작한다. 선택을 저장해두면 다음에 열었을 때 종료 탭이 떠 있어
  // "내 공모가 다 사라졌다"로 읽힌다 — 필터는 기억하지 않는 편이 안전하다.
  const [exhibitionViewMode, setExhibitionViewMode] = useState<ExhibitionViewMode>(initialViewMode ?? 'active');

  useEffect(() => {
    if (initialViewMode) setExhibitionViewMode(initialViewMode);
  }, [initialViewMode]);
  const emptyExForm = { galleryId: 0, title: '', type: 'SOLO', deadlineStart: '', deadline: '', exhibitStartDate: '', exhibitDate: '', submissionDeadline: '', recruitOnly: false, capacity: 1, capacityMask: null as CapacityMask | null, region: 'SEOUL', description: '', imageUrl: '', customFields: [] as CustomField[], attachments: [] as ExhibitionAttachment[] };
  const [form, setForm] = useState(emptyExForm);
  // 미리보기(좁은 화면 — 하단 줄의 [미리보기])
  const [previewOpen, setPreviewOpen] = useState(false);
  const wideForm = useMediaQuery('(min-width: 1280px)');
  // 첨부파일을 올리는 중 — 다 올라가기 전에 등록하면 그 파일이 빠진다
  const [attachBusy, setAttachBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | null>(null);
  // 미입력 필드 하이라이트 상태
  const [formErrors, setFormErrors] = useState<Set<string>>(new Set());

  // 임시저장 훅
  const { pending: draftPending, savedAt: draftSavedAt, resume: resumeDraft, discard: discardDraft, save: saveDraft, clear: clearDraft, autoSave } = useFormDraft<typeof emptyExForm>('draft_exhibition_form');

  // 내 갤러리 목록 (승인된 것만 공모 등록 가능)
  const { data: myGalleries = [], isLoading: myGalleriesLoading } = useQuery<any[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data),
  });
  const approvedGalleries = myGalleries.filter((g: any) => g.status === 'APPROVED');
  /**
   * 승인된 갤러리가 하나면 고르는 칸 없이 그 갤러리로(지역도 그 갤러리 지역으로 미리 채운다).
   * 렌더 중 상태 맞추기 — effect 에서 setState 하지 않는다(react-hooks/set-state-in-effect).
   */
  const soleGallery = approvedGalleries.length === 1 ? approvedGalleries[0] : null;
  const [prefilledFor, setPrefilledFor] = useState<number | null>(null);
  if (soleGallery && prefilledFor !== soleGallery.id) {
    setPrefilledFor(soleGallery.id);
    setForm(prev => (prev.galleryId ? prev : { ...prev, galleryId: soleGallery.id, region: soleGallery.region || prev.region }));
  }
  // 미리 채운 갤러리·지역만 있으면 쓴 것이 없다 — 이탈 경고·자동저장을 하지 않는다
  const formBase = soleGallery ? { ...emptyExForm, galleryId: soleGallery.id, region: soleGallery.region || emptyExForm.region } : emptyExForm;

  // 폼 변경 감지
  const isDirty = showForm && JSON.stringify(form) !== JSON.stringify(formBase) && JSON.stringify(form) !== JSON.stringify(emptyExForm);
  useUnsavedChanges(isDirty);

  // 폼 변경 시 자동저장
  useEffect(() => {
    if (showForm && isDirty) autoSave(form);
  }, [form, showForm, isDirty, autoSave]);

  // 날짜 순서 · 남은 필수 칸 — 폼 본문과 같은 함수(components/exhibition-form)
  const dateError = exhibitionDateError(form);
  const missingFields = exhibitionMissing(form, { needGallery: true });

  // 폼 열기 — 작성하던 공고가 있으면 폼 위 안내(DraftNotice)에서 이어 쓸지 고른다(예전 window.confirm)
  const openExForm = () => setShowForm(true);

  // 전용 등록 화면(/exhibitions/new)에서는 폼만 연 채로 시작한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (createOnly) openExForm(); }, [createOnly]);


  // 내 공모 목록 — 조회 실패는 삼키지 않는다(감사 M18). 실패면 아래 빈 화면이 "없습니다" 대신 오류를 말한다.
  const { data: exhibitions = [], isError: exhibitionsError } = useQuery<any[]>({
    queryKey: ['my-exhibitions'],
    queryFn: () => api.get('/exhibitions/my-exhibitions').then(r => r.data),
  });

  // 목록은 들어올 때마다 새로 — 다른 사람(작가)이 한 일(자료 제출·정산 확인)로 '지금 할 일' 이 바뀐다
  const { data: operationOverview = [], isLoading: operationOverviewLoading } = useQuery<GalleryOperationOverview[]>({
    queryKey: ['my-operation-overview'],
    queryFn: () => api.get('/exhibitions/my-operation-overview').then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/exhibitions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-operation-overview'] });
      setShowForm(false);
      setForm(emptyExForm);
      setFormErrors(new Set());
      clearDraft();
      toast.success('공모 등록 요청이 제출되었습니다. 관리자 승인 뒤 모집공고에 올라가요.');
      if (createOnly) navigate('/mypage?tab=my-exhibitions');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  const deleteRequestOf = useMyDeleteRequests();
  const overviewItems = operationOverview.length > 0
    ? operationOverview
    : exhibitions.map(makeFallbackOperationOverview);

  // 종료 판정은 서버가 한다(`lib/exhibitionLifecycle.ts`) — 정산 완료 **또는**
  // 전시 종료 20일 경과(단, 정산을 시작했으면 진행 중 유지).
  // 갤러리가 [전시종료]조차 안 누른 공모가 영원히 '진행 중' 으로 쌓이는 걸 막는다.
  // 옛 응답(closed 없음)은 예전 규칙(정산 완료)으로 떨어진다.
  const isClosedItem = (x: any) => x.closed ?? !!x.settledAt;
  const activeExhibitions = overviewItems.filter((x) => !isClosedItem(x));
  // 최근에 끝난 것부터 — 오래된 기록일수록 아래로. 정산을 안 한 공모는 전시 종료일이 기준이 된다
  const closedExhibitions = overviewItems
    .filter(isClosedItem)
    .sort((a: any, b: any) => new Date(b.settledAt ?? b.exhibitDate ?? 0).getTime() - new Date(a.settledAt ?? a.exhibitDate ?? 0).getTime());
  const shownExhibitions = exhibitionViewMode === 'closed' ? closedExhibitions : activeExhibitions;

  /*
    공모 한 건 화면(2026-11-20, 규칙 88) — 주소 `?ex=<id>` 가 곧 열림이다. 공모 상세의 [지원자 보기]·운영 주소·알림이 이 주소로 보낸다.
    옛 `&panel=applicants` 는 지원자 탭으로, `&panel=operation` 은 단계 기본 탭으로 연다. 안쪽 탭은 들어올 때 한 번만 읽는다(`view=`).
  */
  const workspaceId = Number(searchParams.get('ex')) || null;
  const navState = (location.state ?? {}) as { fromList?: boolean; view?: string; act?: TaskActionId };
  const viewParam = searchParams.get('view') ?? navState.view ?? (searchParams.get('panel') === 'applicants' ? 'applicants' : null);
  const workspaceView = viewParam && (WORKSPACE_VIEWS as string[]).includes(viewParam) ? viewParam as WorkspaceView : null;
  const openExhibition = (id: number, opts: { view?: WorkspaceView | null; act?: TaskActionId } = {}) => {
    rememberListScroll('my-exhibitions');
    navigate(`/mypage?tab=my-exhibitions&ex=${id}`, { state: { fromList: true, view: opts.view ?? undefined, act: opts.act } });
  };
  // 목록에서 왔으면 뒤로(앱 뒤로가기와 같다), 바로 들어왔으면 목록으로 갈아 끼운다 — 기록이 쌓이지 않게
  // ⚠️ 저장 안 된 입력을 버리고 닫을 땐 갈아 끼운다 — 그 화면이 쌓아 둔 가드 항목(useUnsavedChanges)을 뒤로 지나가면 한 번 더 묻는다
  const closeExhibition = () => {
    if (navState.fromList && !hasUnsavedChanges()) navigate(-1);
    else navigate('/mypage?tab=my-exhibitions', { replace: true });
  };
  // 알림으로 바로 들어온 종료된 공모 — 돌아갈 목록은 [종료] 탭(렌더 중 상태 맞추기, 한 번만)
  const [placedFor, setPlacedFor] = useState<number | null>(null);
  if (workspaceId && overviewItems.length > 0 && placedFor !== workspaceId) {
    setPlacedFor(workspaceId);
    const item = overviewItems.find((x) => x.id === workspaceId);
    if (item) setExhibitionViewMode(isClosedItem(item) ? 'closed' : 'active');
  }
  useLayoutEffect(() => {
    if (workspaceId) return;
    const y = takeListScroll('my-exhibitions');
    // 즉시 — html 의 scroll-behavior: smooth 를 그대로 타면 목록 맨 위에서 보던 자리까지 1.5초를 굴러 내려갔다(2026-11-20 LST-07, 공모 92개 실측)
    if (y != null) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  }, [workspaceId]);

  /** 목록 한 줄 — 상태 · 보조 · 제목 · 진행 띠 · 지금 할 일 + 주 버튼(누르면 그 공모 화면으로, 확인이 필요한 일은 도착해서 묻는다) */
  const rowOf = (item: GalleryOperationOverview) => {
    const apps = item.counts.applications;
    const submissions = item.counts.submissions;
    const settlement = item.counts.settlement;
    const pending = apps.submitted + apps.reviewed;
    const incomplete = Math.max(0, submissions.required - submissions.complete);
    const settlementStarted = item.counts.sales.total > 0 || !!item.settlementRequestedAt;
    const stage = stageOf({ ...item, settlementStarted })!;
    const approvals = { total: settlement.total, approved: settlement.approved, issue: settlement.issue };
    const task = galleryNextTask({
      status: item.status,
      recruitOnly: !!item.recruitOnly,
      recruitmentClosed: !!item.recruitmentClosed,
      confirmed: !!item.confirmed,
      ended: !!item.ended,
      settled: !!item.settledAt,
      settlementRequested: !!item.settlementRequestedAt,
      deadline: item.deadline,
      exhibitStartDate: item.exhibitStartDate,
      exhibitDate: item.exhibitDate,
      pending,
      accepted: apps.accepted,
      capacity: item.capacity ?? null,
      capacityMask: item.capacityMask ?? null,
      submissionsIncomplete: incomplete,
      sales: item.counts.sales.total,
      approvals,
    });
    const strip = flowStrip('gallery', {
      ...item, settlementStarted,
      accepted: apps.accepted, pending,
      capacity: item.capacity ?? null, capacityMask: item.capacityMask ?? null,
      submissionsComplete: submissions.complete, submissionsRequired: submissions.required,
      sales: item.counts.sales.total, approvals,
    });
    const todo = task.tone === 'attention';
    const approved = item.status === 'APPROVED';
    const view = viewForTarget(task.target);
    // 급한 정도 — 그 단계의 기한(가까운 것부터). 기한이 없으면 뒤로
    const due = !item.recruitmentClosed ? item.deadline : !item.ended ? (item.submissionDeadline ?? item.exhibitStartDate) : item.settlementRequestedAt ?? item.exhibitDate;
    const urgency = due ? getDday(due) : Number.MAX_SAFE_INTEGER;
    const deleteRequest = deleteRequestOf('exhibition', item.id);
    return {
      todo,
      urgency,
      node: (
        <ExhibitionRow
          key={item.id}
          id={`ex-card-${item.id}`}
          wide={wideList}
          poster={item.imageUrl}
          status={stage.label}
          sub={<>{gallerySubText({ stageKey: stage.key, deadline: item.deadline, submissionDeadline: item.submissionDeadline, exhibitStartDate: item.exhibitStartDate, exhibitDate: item.exhibitDate, settledAt: item.settledAt, settlementRequestedAt: item.settlementRequestedAt, viewCount: approved ? item.viewCount : null })}<HostBadge exhibition={item} className="ml-2" /></>}
          title={item.title}
          meta={`${item.gallery?.name || '아트링크'} · ${exhibitionTypeLabels[item.type] || item.type} · ${regionLabels[item.region] || item.region}`}
          strip={strip}
          task={task}
          actionLabel={todo ? (task.primary?.label ?? task.action ?? (item.status === 'REJECTED' ? '사유 보기' : undefined)) : undefined}
          mobileActionLabel={task.action ?? (item.status === 'REJECTED' ? '사유 보기' : undefined)}
          onOpen={() => openExhibition(item.id)}
          onAction={() => openExhibition(item.id, { view, act: task.act })}
        >
          {item.status === 'REJECTED' && item.rejectReason && (
            <p className="mt-1.5 line-clamp-2 break-keep text-[13px] text-gray-600 [overflow-wrap:anywhere]"><b className="font-semibold text-accent">반려 사유</b> · {item.rejectReason}</p>
          )}
          <DeleteRequestLine request={deleteRequest} kind="exhibition" />
        </ExhibitionRow>
      ),
    };
  };

  const clearError = (key: string) => setFormErrors(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });

  /**
   * [등록 요청] — 남은 필수 칸이 있으면 그 칸으로 데려가고(하단 줄과 같은 목록), 다 채웠으면 확인 창.
   * 약관 동의는 확인 창 안에서 받는다(2026-11-15 — 예전엔 폼 끝 약관 상자에 체크해야 했다).
   */
  const requestSubmit = () => {
    if (attachBusy) {
      toast.error('첨부파일을 올리는 중이에요. 다 올라간 뒤에 눌러 주세요.');
      return;
    }
    if (missingFields.length > 0) {
      setFormErrors(new Set(missingFields.map((m) => m.key)));
      jumpToField(missingFields[0].key);
      return;
    }
    if (dateError) {
      toast.error(dateError);
      jumpToField('deadlineStart');
      return;
    }
    const cleanedCustomFields = sanitizeCustomFields(form.customFields);
    if (cleanedCustomFields.some((field) => (field.type === 'select' || field.type === 'multiselect') && (field.options ?? []).length < 2)) {
      toast.error('객관식 질문은 선택지를 2개 이상 입력해주세요.');
      return;
    }
    setForm(prev => ({ ...prev, customFields: cleanedCustomFields }));
    setConfirmAction('submit');
  };
  const saveExDraft = () => {
    if (saveDraft(form)) toast.success('임시저장했어요. 이 브라우저에 남아 있어요.');
    else {
      toast.error(draftPending ? '작성하던 공고를 먼저 [이어서 쓰기] 또는 [새로 쓰기]로 정해 주세요.' : '임시저장하지 못했어요.');
      if (draftPending) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const cancelExForm = () => {
    if (isDirty) setConfirmAction('cancel');
    else if (createOnly) navigate(-1);
    else { setShowForm(false); setFormErrors(new Set()); }
  };

  const summary = scheduleSummary(form);
  const selectedGallery = approvedGalleries.find((g: any) => g.id === form.galleryId) ?? null;
  const previewOf = () => exhibitionPreview(form, { gallery: selectedGallery });

  return (
    <div>
      {showForm && (myGalleriesLoading ? (
        <div className="h-40 animate-pulse bg-gray-50" />
      ) : approvedGalleries.length === 0 ? (
        <Notice
          tone="attention"
          title="승인된 갤러리가 없어요"
          action={<button type="button" onClick={() => navigate('/galleries/new')} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50">갤러리 등록하기</button>}
        >
          공모는 승인된 갤러리 이름으로 올라가요. 먼저 갤러리를 등록하고 승인을 받아 주세요.
        </Notice>
      ) : (
        <div>
          {/* 작성하던 공고 — 고를 때까지 아무것도 덮어쓰지 않는다(lib/formDraft.ts) */}
          {draftPending && (
            <div className="mb-6">
              <DraftNotice
                title="작성하던 공고가 있어요"
                summary={draftPending.data.title}
                savedAt={draftPending.savedAt}
                onResume={() => { const d = resumeDraft(); if (d) setForm({ ...emptyExForm, ...d, attachments: normalizeAttachments((d as { attachments?: unknown }).attachments) }); }}
                onDiscard={discardDraft}
              />
            </div>
          )}
          {/* 왼쪽 입력 · 오른쪽 미리보기(1280px 이상). 순서는 공고 상세와 같다(규칙 83) */}
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
            <div className="min-w-0 max-w-[720px]">
              <ExhibitionFormBody
                form={form}
                setForm={setForm}
                errors={formErrors}
                clearError={clearError}
                onAttachBusy={setAttachBusy}
                idPrefix="ex"
                hostField={soleGallery ? (
                  <div>
                    <p className="text-sm font-medium text-gray-800">갤러리</p>
                    <p className="mt-2 text-[15px] text-gray-900">{soleGallery.name}</p>
                  </div>
                ) : (
                  <div data-field="galleryId">
                    <FormField label="갤러리 *" error={formErrors.has('galleryId')} htmlFor="ex-gallery">
                      <select
                        id="ex-gallery"
                        data-form-error={formErrors.has('galleryId') || undefined}
                        value={form.galleryId}
                        onChange={e => {
                          const g = approvedGalleries.find((x: any) => x.id === Number(e.target.value));
                          setForm(prev => ({ ...prev, galleryId: Number(e.target.value), ...(g?.region ? { region: g.region } : {}) }));
                          clearError('galleryId');
                        }}
                        className={formInputCls(formErrors.has('galleryId'))}
                      >
                        <option value={0}>갤러리 선택</option>
                        {approvedGalleries.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </FormField>
                  </div>
                )}
              />
            </div>
            {wideForm && <PreviewAside preview={previewOf()} />}
          </div>
          <StickySubmitBar
            missing={missingFields}
            onJump={jumpToField}
            savedAt={draftSavedAt}
            onSaveDraft={saveExDraft}
            onPreview={wideForm ? undefined : () => setPreviewOpen(true)}
            onCancel={cancelExForm}
            submitLabel="등록 요청"
            onSubmit={requestSubmit}
            pending={createMutation.isPending}
          />
          {previewOpen && !wideForm && <PreviewSheet preview={previewOf()} onClose={() => setPreviewOpen(false)} />}
        </div>
      ))}

      {/* 등록 확인 — 무엇이 올라가는지 + 공모 등록 약관 동의(components/form/SubmitSheet) */}
      {confirmAction === 'submit' && (
        <SubmitSheet
          title="등록을 요청할까요?"
          rows={[
            ['공모', form.title],
            ...(summary ? [['일정', summary] as [string, ReactNode]] : []),
            ['모집', `${exhibitionTypeLabels[form.type] ?? form.type} · ${capacityText(form)} · ${regionLabels[form.region] ?? form.region}`],
            ...(form.attachments.length ? [['첨부', `${form.attachments.length}개`] as [string, ReactNode]] : []),
          ]}
          note="관리자가 확인하면 알림으로 알려 드려요. 승인 뒤에도 소개·포스터·첨부파일·추가 질문·모집 인원·지역은 고칠 수 있어요. 날짜는 1:1 문의로 바꿔요."
          terms={{ url: '/terms/exhibition-application.txt', label: '공모 등록 약관' }}
          confirmLabel="등록 요청"
          pending={createMutation.isPending}
          onConfirm={() => { setConfirmAction(null); createMutation.mutate({ ...form, ...capacityPayload({ capacity: form.capacity, capacityMask: form.capacityMask ?? null }), customFields: sanitizeCustomFields(form.customFields) }); }}
          onClose={() => setConfirmAction(null)}
        />
      )}
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="작성 취소"
        message={'작성 중인 내용이 있습니다. 정말 취소하시겠습니까?\n임시저장된 내용은 유지됩니다.'}
        confirmText="취소하기"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); setShowForm(false); setFormErrors(new Set()); if (createOnly) navigate(-1); }}
        onCancel={() => setConfirmAction(null)}
      />

      {!showForm && workspaceId && (
        <ExhibitionWorkspace
          key={workspaceId}
          exhibitionId={workspaceId}
          initialView={workspaceView}
          initialAct={navState.act ?? null}
          onClose={closeExhibition}
        />
      )}

      {!showForm && !workspaceId && (
        <div>
          {/* 머리 — 제목 · [공모 등록](테두리). 설명 한 줄은 없앴다(2026-11-20 — 줄마다 지금 할 일이 적혀 있다) */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold text-gray-950">내 공모</h2>
            <button onClick={() => navigate('/exhibitions/new')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50">
              <Plus size={14} aria-hidden /> 공모 등록
            </button>
          </div>

          <div className="mt-3">
            <PageTabBar<ExhibitionViewMode>
              sticky={false}
              idPrefix="my-exhibitions"
              label="공모 목록"
              active={exhibitionViewMode}
              onSelect={setExhibitionViewMode}
              tabs={[
                { id: 'active', label: '진행 중', count: activeExhibitions.length },
                { id: 'closed', label: '종료', count: closedExhibitions.length },
              ]}
            />
          </div>

          {operationOverviewLoading ? (
            <div className="mt-6 grid gap-4">
              {[0, 1].map(i => <div key={i} className="h-40 animate-pulse bg-gray-100" />)}
            </div>
          ) : shownExhibitions.length === 0 ? (
            <div className="mt-6 border-y border-gray-200 py-12 text-center">
              {exhibitionViewMode === 'closed' ? (
                <p className="text-sm text-gray-500">아직 정산까지 끝난 공모가 없어요.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-500">{exhibitionsError ? '공모 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : closedExhibitions.length > 0 ? '진행 중인 공모가 없어요.' : '아직 올린 공모가 없어요.'}</p>
                  <button onClick={() => navigate('/exhibitions/new')} className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50">
                    <Plus size={14} aria-hidden /> 공모 등록
                  </button>
                </>
              )}
            </div>
          ) : exhibitionViewMode === 'closed' ? (
            <ul className="mt-2">{shownExhibitions.map(item => rowOf(item).node)}</ul>
          ) : (() => {
            const rows = shownExhibitions.map(rowOf);
            // 지금 할 일 — 급한 순(관련 기한이 가까운 것부터) · 기다리는 중 — 최근 순(서버 순서)
            const todo = rows.filter(r => r.todo).sort((a, b) => a.urgency - b.urgency);
            const waiting = rows.filter(r => !r.todo);
            return (
              <>
                {todo.length > 0 && (
                  <>
                    <RowGroupHead label="지금 할 일" count={todo.length} first />
                    <ul>{todo.map(r => r.node)}</ul>
                  </>
                )}
                {waiting.length > 0 && (
                  <>
                    <RowGroupHead label="기다리는 중" count={waiting.length} first={todo.length === 0} />
                    <ul>{waiting.map(r => r.node)}</ul>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}


// ========== Gallery: 내 전시(Show) 관리 ==========
function MyShowsSection({ createOnly = false }: { createOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showForm, setShowForm] = useState(false);
  // 전용 등록 화면(/shows/new)에서는 폼만 연 채로 시작한다.
  useEffect(() => { if (createOnly) setShowForm(true); }, [createOnly]);

  // 내 갤러리 (전시 등록 시 선택용) — owned=true로 본인 갤러리 전체 조회 (/galleries/my 라우트는 없음)
  const { data: myGalleries = [], isLoading: myGalleriesLoading } = useQuery<Gallery[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data),
  });
  const approvedGalleries = myGalleries.filter(g => g.status === 'APPROVED');
  // 승인된 갤러리가 하나면 고르는 칸 없이 그 갤러리로 — 장소는 그 주소, 지역은 그 지역으로 미리 채운다(렌더 중 상태 맞추기)
  const soleGallery = approvedGalleries.length === 1 ? approvedGalleries[0] : null;
  const [prefilledFor, setPrefilledFor] = useState<number | null>(null);

  // 내 전시 목록
  const { data: myShows = [], isLoading } = useQuery<Show[]>({
    queryKey: ['my-shows'],
    queryFn: () => api.get('/shows/my-shows').then(r => r.data),
  });

  // 전시 등록 폼 상태
  const [form, setForm] = useState<ShowFormValues>({ ...emptyShowForm });
  if (soleGallery && prefilledFor !== soleGallery.id) {
    setPrefilledFor(soleGallery.id);
    setForm((prev) => (prev.galleryId ? prev : { ...prev, galleryId: soleGallery.id, location: prev.location || soleGallery.address || '', region: soleGallery.region || prev.region }));
  }
  const showBase: ShowFormValues = soleGallery ? { ...emptyShowForm, galleryId: soleGallery.id, location: soleGallery.address || '', region: soleGallery.region || emptyShowForm.region } : emptyShowForm;
  const [showErrors, setShowErrors] = useState<Set<string>>(new Set());
  const clearShowError = (key: string) => setShowErrors((prev) => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
  const [confirmShow, setConfirmShow] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const wideForm = useMediaQuery('(min-width: 1280px)');

  // 참여 작가 (동적 — 이름 · 아트링크 작가면 연동)
  const [artists, setArtists] = useState<ArtistEntry[]>([{ name: '' }]);

  // 이탈 경고·임시저장 — 갤러리·공모 폼엔 있었는데 전시 폼만 없어 포스터·작가 목록까지 채운 뒤 링크 한 번이면 사라졌다(감사 M19)
  const { pending: draftPending, savedAt: draftSavedAt, resume: resumeDraft, discard: discardDraft, save: saveDraft, clear: clearDraft, autoSave } = useFormDraft<{ form: ShowFormValues; artists: ArtistEntry[] }>('draft_show_form');
  const isDirty = showForm && ((JSON.stringify(form) !== JSON.stringify(showBase) && JSON.stringify(form) !== JSON.stringify(emptyShowForm)) || artists.some(a => a.name.trim() || a.userId));
  useUnsavedChanges(isDirty);
  useEffect(() => { if (showForm && isDirty) autoSave({ form, artists }); }, [form, artists, showForm, isDirty, autoSave]);
  // 작성하던 전시가 있으면 폼 위 안내(DraftNotice)에서 이어 쓸지 고른다(예전 window.confirm)
  const resumeShowDraft = () => {
    const d = resumeDraft();
    if (!d) return;
    setForm({ ...emptyShowForm, ...d.form });
    if (Array.isArray(d.artists) && d.artists.length) setArtists(d.artists);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/shows', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shows'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      setShowForm(false);
      setForm({ ...emptyShowForm });
      setArtists([{ name: '' }]);
      setShowErrors(new Set());
      clearDraft();
      toast.success('전시 등록 요청이 완료되었습니다. Admin 승인을 기다려주세요.');
      if (createOnly) navigate('/mypage?tab=my-shows');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shows'] });
      toast.success('전시가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '전시 삭제에 실패했습니다.'),
  });

  // 전시 삭제 이중확인 ("삭제" 입력)
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  /** [등록 요청] — 남은 필수 칸이 있으면 그 칸으로(하단 줄과 같은 목록), 다 채웠으면 확인 창(약관 동의 포함) */
  const missingShow = showMissing(form, { needGallery: !soleGallery });
  const handleSubmit = () => {
    if (missingShow.length > 0) {
      setShowErrors(new Set(missingShow.map((m) => m.key)));
      jumpToField(missingShow[0].key);
      return;
    }
    if (new Date(form.startDate) > new Date(form.endDate)) {
      toast.error('시작일은 종료일 이전이어야 합니다.');
      jumpToField('startDate');
      return;
    }
    const hoursError = openingHoursError(form.openingHours);
    if (hoursError) { toast.error(hoursError); jumpToField('openingHours'); return; }
    setConfirmShow(true);
  };
  const submitShow = () => {
    setConfirmShow(false);
    const validArtists = artists.filter(a => a.name.trim());
    createMutation.mutate({
      ...form,
      artists: validArtists.length > 0 ? validArtists : null,
      additionalImages: form.additionalImages.map(img => img.url),
    });
  };
  const selectedShowGallery = approvedGalleries.find((g) => g.id === form.galleryId) ?? null;
  const showPreviewOf = () => showPreview(form, artists, selectedShowGallery ? { id: selectedShowGallery.id, name: selectedShowGallery.name } : null);

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-accent/10 text-accent',
  };
  const statusLabels: Record<string, string> = {
    PENDING: '승인 대기', APPROVED: '승인 완료', REJECTED: '승인 거절',
  };

  return (
    <div>
      {!createOnly && (
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">내 전시</h3>
          <button
            onClick={() => navigate('/shows/new')}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/5 transition-colors"
          >
            <Plus size={14} /> 전시 등록
          </button>
        </div>
      )}

      {/* 등록 폼 — 왼쪽 입력 · 오른쪽 미리보기(1280px 이상), 아래 고정 줄. 약관은 [등록 요청] 확인 창 안(components/form/SubmitSheet) */}
      {showForm && (myGalleriesLoading ? (
        <div className="h-40 animate-pulse bg-gray-50" />
      ) : approvedGalleries.length === 0 ? (
        <Notice
          tone="attention"
          title="승인된 갤러리가 없어요"
          action={<button type="button" onClick={() => navigate('/galleries/new')} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50">갤러리 등록하기</button>}
        >
          전시는 승인된 갤러리 이름으로 올라가요. 먼저 갤러리를 등록하고 승인을 받아 주세요.
        </Notice>
      ) : (
        <div>
          {draftPending && (
            <div className="mb-6">
              <DraftNotice
                title="작성하던 전시가 있어요"
                summary={draftPending.data.form?.title}
                savedAt={draftPending.savedAt}
                onResume={resumeShowDraft}
                onDiscard={discardDraft}
              />
            </div>
          )}
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
            <div className="min-w-0 max-w-[720px]">
              <ShowFormBody
                form={form}
                setForm={setForm}
                artists={artists}
                setArtists={setArtists}
                errors={showErrors}
                clearError={clearShowError}
                hostField={soleGallery ? (
                  <div>
                    <p className="text-sm font-medium text-gray-800">갤러리</p>
                    <p className="mt-2 text-[15px] text-gray-900">{soleGallery.name}</p>
                  </div>
                ) : (
                  <div data-field="galleryId">
                    <FormField label="갤러리 *" error={showErrors.has('galleryId')} htmlFor="show-gallery">
                      <select
                        id="show-gallery"
                        value={form.galleryId}
                        data-form-error={showErrors.has('galleryId') || undefined}
                        onChange={e => {
                          const gid = Number(e.target.value);
                          const g = approvedGalleries.find(x => x.id === gid);
                          setForm(prev => {
                            const prevG = approvedGalleries.find(x => x.id === prev.galleryId);
                            // 장소를 직접 고치지 않았으면(비었거나 이전 갤러리 주소 그대로) 고른 갤러리 주소로
                            const locUntouched = !prev.location || (!!prevG && prev.location === prevG.address);
                            return { ...prev, galleryId: gid, location: g && locUntouched ? g.address : prev.location, region: g ? g.region : prev.region };
                          });
                          clearShowError('galleryId');
                        }}
                        className={formInputCls(showErrors.has('galleryId'))}
                      >
                        <option value={0}>갤러리 선택</option>
                        {approvedGalleries.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </FormField>
                  </div>
                )}
              />
            </div>
            {wideForm && <PreviewAside preview={showPreviewOf()} />}
          </div>
          <StickySubmitBar
            missing={missingShow}
            onJump={jumpToField}
            savedAt={draftSavedAt}
            onSaveDraft={() => {
              if (saveDraft({ form, artists })) toast.success('임시저장했어요. 이 브라우저에 남아 있어요.');
              else toast.error(draftPending ? '작성하던 전시를 먼저 [이어서 쓰기] 또는 [새로 쓰기]로 정해 주세요.' : '임시저장하지 못했어요.');
            }}
            onPreview={wideForm ? undefined : () => setPreviewOpen(true)}
            onCancel={() => navigate(-1)}
            submitLabel="등록 요청"
            onSubmit={handleSubmit}
            pending={createMutation.isPending}
          />
          {previewOpen && !wideForm && <PreviewSheet preview={showPreviewOf()} onClose={() => setPreviewOpen(false)} />}
        </div>
      ))}

      {confirmShow && (
        <SubmitSheet
          title="등록을 요청할까요?"
          rows={[
            ['전시', form.title],
            ['기간', `${form.startDate.replace(/-/g, '.')} – ${form.endDate.replace(/-/g, '.')}`],
            ['장소', `${form.location} · ${regionLabels[form.region] ?? form.region}`],
            ...(artists.some(a => a.name.trim()) ? [['작가', artists.filter(a => a.name.trim()).map(a => a.name.trim()).join(', ')] as [string, ReactNode]] : []),
          ]}
          note="관리자가 확인하면 알림으로 알려 드려요. 승인 뒤에도 전시 상세에서 포스터·사진·소개를 바로 고칠 수 있어요."
          terms={{ url: '/terms/show-registration.txt', label: '전시 등록 약관' }}
          confirmLabel="등록 요청"
          pending={createMutation.isPending}
          onConfirm={submitShow}
          onClose={() => setConfirmShow(false)}
        />
      )}

      {/* 내 전시 목록 (전용 등록 화면에서는 숨김) */}
      {!createOnly && (isLoading ? (
        <div className="h-32 bg-gray-100 animate-pulse" />
      ) : myShows.length === 0 ? (
        <p className="text-gray-400 text-center py-8">등록한 전시가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {myShows.map(show => (
            <div key={show.id} className="p-4 border border-gray-100 rounded-xl">
              <div className="flex justify-between items-start">
                <div>
                  <button onClick={() => navigate(`/shows/${show.id}`)} className="font-medium hover:text-gray-900">{show.title}</button>
                  <p className="text-xs text-gray-500 mt-1">{show.gallery?.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[show.status]}`}>
                    {statusLabels[show.status]}
                  </span>
                  <button onClick={() => setDeleteTarget(show)}
                    className="min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center text-gray-400 hover:text-accent"
                    aria-label="삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {show.rejectReason && (
                <p className="text-xs text-accent mt-2 flex items-center gap-1">
                  <AlertTriangle size={12} /> 거절 사유: {show.rejectReason}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}

      <DeleteConfirmModal
        open={!!deleteTarget}
        name={deleteTarget?.title ?? ''}
        description="전시를 삭제하면 되돌릴 수 없습니다."
        pending={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ========== Admin: 승인 관리 ==========
// ========== Admin: 히어로 슬라이드 관리 ==========
function HeroManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', description: '', imageUrl: '', mobileImageUrl: '', linkUrl: '', order: 0, textTone: 'auto' as HeroToneChoice });
  const [preview, setPreview] = useState(false);
  // 미리보기 글자 색 — 고정했으면 그 색, 자동이면 사진 밝기로 어림(실제 배너는 글자 상자를 재서 고른다)
  const autoTone = useHeroAutoTones(form.imageUrl);
  const previewTone = (k: 'btn' | 'title') => TONE_CLASS[form.textTone !== 'auto' ? form.textTone : autoTone?.[k] ?? 'white'];

  const { data: slides = [] } = useQuery<any[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/hero-slides', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hero-slides'] });
      resetForm();
      toast.success('슬라이드가 등록되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '슬라이드 등록에 실패했습니다.'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/hero-slides/${editingId}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hero-slides'] });
      resetForm();
      toast.success('슬라이드가 수정되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '슬라이드 수정에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/hero-slides/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hero-slides'] });
      toast.success('슬라이드가 삭제되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '슬라이드 삭제에 실패했습니다.'),
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: '', description: '', imageUrl: '', mobileImageUrl: '', linkUrl: '', order: 0, textTone: 'auto' });
    setPreview(false);
  };

  const startEdit = (s: any) => {
    setForm({ title: s.title, description: s.description || '', imageUrl: s.imageUrl, mobileImageUrl: s.mobileImageUrl || '', linkUrl: s.linkUrl || '', order: s.order, textTone: s.textTone ?? 'auto' });
    setEditingId(s.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">히어로 슬라이드 ({slides.length}개)</h3>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 새 슬라이드
        </button>
      </div>

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <h4 className="font-medium text-sm">{editingId ? '슬라이드 수정' : '새 슬라이드 등록'}</h4>
          <input placeholder="제목 *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <input placeholder="설명" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <input placeholder="링크 URL (선택)" value={form.linkUrl} onChange={e => setForm({...form, linkUrl: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <input type="number" placeholder="순서" value={form.order} onChange={e => setForm({...form, order: Number(e.target.value)})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <ImageUpload value={form.imageUrl} onChange={(url) => setForm({...form, imageUrl: url})} onRemove={() => setForm({...form, imageUrl: ''})} placeholder="슬라이드 이미지 업로드" />
          {/* 모바일 전용 이미지 — 가로로 긴 배너는 폰에서 높이 125px 로 줄어 안에 든 글씨가 안 읽힌다.
              세로형(4:5 권장)을 따로 올리면 좁은 화면에서는 이걸 쓰고, 없으면 위 이미지를 카드로 보여준다. */}
          <div>
            <ImageUpload value={form.mobileImageUrl} onChange={(url) => setForm({...form, mobileImageUrl: url})} onRemove={() => setForm({...form, mobileImageUrl: ''})} placeholder="모바일 전용 이미지 (선택, 세로형 4:5 권장)" />
            <p className="mt-1 text-xs text-gray-500">폰 화면에서는 가로 배너가 손가락 두 마디 높이로 줄어듭니다. 세로형 이미지를 따로 올리면 폰에서는 그걸 씁니다.</p>
          </div>
          <HeroToneField value={form.textTone} onChange={(v) => setForm({ ...form, textTone: v })} imageUrl={form.imageUrl} />

          {/* 미리보기 */}
          <button onClick={() => setPreview(!preview)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900">
            <Eye size={14} /> {preview ? '미리보기 닫기' : '미리보기'}
          </button>
          {preview && form.imageUrl && (
            /* 실제 배너는 자르지 않고(contain) 폰에서는 모바일 전용 이미지를 쓴다(규칙 48) — 미리보기도 같아야 올린 사진이 어떻게 보일지 안다(2026-09-19) */
            <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
              <div className="relative w-full h-40 rounded-lg overflow-hidden bg-gray-100">
                <img src={form.imageUrl} alt="" className="w-full h-full object-contain" />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">데스크톱</span>
                <div className={`absolute bottom-3 left-3 ${previewTone('title').shadow}`}>
                  <p className={`font-bold text-sm ${previewTone('title').text}`}>{form.title || '제목'}</p>
                  <p className={`text-xs ${previewTone('title').sub}`}>{form.description || '설명'}</p>
                </div>
                {/* 실제 배너와 같은 자리·모양 — 사진 오른쪽 위, 밑줄 글자(2026-10-05) */}
                {form.linkUrl && <span className={`absolute top-3 right-3 text-xs underline underline-offset-4 ${previewTone('btn').link} ${previewTone('btn').shadow}`}>자세히 보기 →</span>}
              </div>
              <div className="relative w-full h-40 rounded-lg overflow-hidden bg-gray-100">
                <img src={form.mobileImageUrl || form.imageUrl} alt="" className="w-full h-full object-contain" />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">모바일{form.mobileImageUrl ? '' : ' (전용 이미지 없음)'}</span>
              </div>
            </div>
          )}
          {preview && !form.imageUrl && (
            <div className="w-full h-40 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-sm text-gray-400">
              이미지를 먼저 등록하세요
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!form.title || !form.imageUrl) { toast.error('제목과 이미지는 필수입니다.'); return; }
                editingId ? updateMutation.mutate() : createMutation.mutate();
              }}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
            >{editingId ? '수정' : '등록'}</button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      {/* 슬라이드 목록 */}
      <div className="space-y-3">
        {slides.map((s: any) => (
          <div key={s.id} className="flex gap-3 p-3 border border-gray-100 rounded-xl items-center">
            <img src={s.imageUrl} alt="" className="w-20 h-14 object-cover rounded-lg flex-none" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{s.title}</p>
              <p className="text-xs text-gray-500 truncate">{s.description}</p>
              <p className="text-[11px] text-gray-400">{s.mobileImageUrl ? '모바일 이미지 있음' : '모바일 이미지 없음 · 폰에서는 카드로 표시'}</p>
            </div>
            <div className="flex gap-1 flex-none">
              <button onClick={() => startEdit(s)} className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-900" aria-label="수정"><Edit3 size={14} /></button>
              <ConfirmDeleteButton onConfirm={() => deleteMutation.mutate(s.id)} title="슬라이드 삭제" message="이 배너 슬라이드를 지웁니다. 이미지 파일도 함께 삭제되어 되돌릴 수 없습니다." className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-accent"><Trash2 size={14} /></ConfirmDeleteButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== Admin: 이달의 갤러리 관리 ==========
function GotmManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGalleryId, setSelectedGalleryId] = useState<number | null>(null);
  const [gotmTitle, setGotmTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const { data: gotm = [] } = useQuery<any[]>({
    queryKey: ['gallery-of-month'],
    queryFn: () => api.get('/gallery-of-month').then(r => r.data),
  });

  // 갤러리 검색
  const { data: searchResults = [] } = useQuery<any[]>({
    queryKey: ['galleries', 'picker'],   // 검색어를 키에 넣으면 타자마다 전체 목록을 다시 받아 깜빡였다(필터는 클라이언트, 2026-09-19)
    queryFn: () => api.get('/galleries').then(r => r.data),
    enabled: showForm,
  });

  const filteredResults = searchResults.filter((g: any) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !gotm.some((item: any) => item.galleryId === g.id)
  );

  const createMutation = useMutation({
    mutationFn: () => api.post('/gallery-of-month', { galleryId: selectedGalleryId, expiresAt, title: gotmTitle || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      setShowForm(false);
      setSelectedGalleryId(null);
      setGotmTitle('');
      setExpiresAt('');
      toast.success('이달의 갤러리가 등록되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/gallery-of-month/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery-of-month'] });
      toast.success('삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제에 실패했습니다.'),
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">이달의 갤러리 ({gotm.length}개)</h3>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 갤러리 선정
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <h4 className="font-medium text-sm">갤러리 검색 및 선정</h4>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="갤러리명 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 p-2.5 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          {filteredResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
              {filteredResults.map((g: any) => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGalleryId(g.id)}
                  className={`w-full text-left p-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-gray-50 ${selectedGalleryId === g.id ? 'bg-gray-100' : ''}`}
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-gray-400 ml-2">({regionLabels[g.region]})</span>
                </button>
              ))}
            </div>
          )}
          {selectedGalleryId && (
            <p className="text-sm text-green-600">선택됨: {searchResults.find((g: any) => g.id === selectedGalleryId)?.name}</p>
          )}
          <div>
            <label className="text-xs text-gray-500">선정 제목 (선택)</label>
            <input placeholder="예: 세련된 감각의 신규 갤러리" value={gotmTitle} onChange={e => setGotmTitle(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500">등록 기한</label>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!selectedGalleryId || !expiresAt) { toast.error('갤러리와 기한을 선택해주세요.'); return; }
                createMutation.mutate();
              }}
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
            >{createMutation.isPending ? '선정 중...' : '선정'}</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {gotm.map((item: any) => (
          <div key={item.id} className="flex gap-3 p-3 border border-gray-100 rounded-xl items-center">
            {item.gallery?.mainImage && <img src={item.gallery.mainImage} alt="" className="w-14 h-14 object-cover rounded-lg flex-none" />}
            <div className="flex-1">
              <p className="font-medium text-sm">{item.gallery?.name}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar size={12} /> 만료: {new Date(item.expiresAt).toLocaleDateString('ko')}
              </p>
            </div>
            <ConfirmDeleteButton onConfirm={() => deleteMutation.mutate(item.id)} title="이달의 갤러리 해제" message="이 갤러리를 이달의 갤러리에서 내립니다." confirmText="해제" className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-accent">
              <Trash2 size={14} />
            </ConfirmDeleteButton>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== Admin: 신고 관리 ==========
// 옛 쪽지(Message) 신고 구역은 2026-11-19 에 화면에서 뗐다 — 대화는 ArtTalk 이고, 그 신고는 components/admin/ChatReportsSection.tsx.
// (옛 `GET/PATCH /api/reports` 라우트와 표는 남아 있다 — retiredApis.test.ts 가 화면에서 다시 부르지 않게 막는다)

// ========== 개발자 도구 (Admin) — 런타임 전역 플래그 토글 ==========
function DevToolsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ allowAcceptedRevert: boolean }>({
    queryKey: ['dev-settings'],
    queryFn: () => api.get('/admin/dev-settings').then(r => r.data),
    staleTime: 0,
  });
  const toggleMutation = useMutation({
    mutationFn: (allowAcceptedRevert: boolean) =>
      api.put('/admin/dev-settings', { allowAcceptedRevert }).then(r => r.data),
    onSuccess: (res) => {
      queryClient.setQueryData(['dev-settings'], res);
      queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
      toast.success(res.allowAcceptedRevert ? '수락 되돌리기가 활성화되었습니다.' : '수락 되돌리기가 비활성화되었습니다.');
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || '설정 변경에 실패했습니다.');
    },
  });

  const on = !!data?.allowAcceptedRevert;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <p>개발/운영 지원용 임시 도구입니다. 필요할 때만 켜고, 작업이 끝나면 반드시 꺼주세요.</p>
      </div>

      <div className="border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-base font-medium text-gray-900">수락 상태 되돌리기 허용</p>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              켜면 <b>전체 갤러리</b>가 지원자 관리에서 <b>수락한 지원을 거절로</b> 변경할 수 있습니다.<br />
              거절로 되돌리면 해당 작가의 운영페이지 제출자료(출품리스트·약력·노트)와 판매·정산 기록이 <b className="text-accent">모두 삭제</b>되고,
              모집 정원 슬롯이 복구됩니다. (정산 완료된 공모는 되돌리기 불가)
            </p>
          </div>
          {isLoading ? (
            <div className="w-12 h-7 rounded-full bg-gray-100 animate-pulse shrink-0" />
          ) : (
            <button
              role="switch"
              aria-checked={on}
              aria-label="수락 상태 되돌리기 허용"
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(!on)}
              className={`relative w-12 h-7 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${on ? 'bg-accent' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
            </button>
          )}
        </div>
        <p className={`mt-3 text-xs font-medium ${on ? 'text-accent' : 'text-gray-400'}`}>
          {isLoading ? '상태 확인 중...' : on ? '● 현재 활성화됨 — 전체 갤러리에 적용 중' : '○ 현재 비활성화됨 (기본값)'}
        </p>
      </div>
    </div>
  );
}

// ===== 전용 등록 화면 (커뮤니티 글쓰기처럼 별도 페이지로 이동) =====
// 목록 페이지·마이페이지의 [등록] 버튼이 여기로 온다. 폼만 보여주고(createOnly),
// 제출하면 마이페이지의 내 목록으로, 취소/뒤로가기는 이전 화면으로.
function RegisterShell({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  if (user && user.role !== 'GALLERY') return <Navigate to="/" replace />;
  // 넓게 — 1280px 이상에서는 입력 오른쪽에 미리보기가 붙는다(입력 칸은 720px 까지). 아래 끝은 하단 고정 줄(StickySubmitBar)
  return (
    <div className="mx-auto max-w-6xl px-6 pt-5 md:px-12 md:pt-10">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft size={16} aria-hidden /> 뒤로가기
      </button>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 md:text-[30px]">{title}</h1>
      <div className="mt-6 md:mt-8">{children}</div>
    </div>
  );
}

export function GalleryRegisterPage() {
  return <RegisterShell title="갤러리 등록"><MyGalleriesSection createOnly /></RegisterShell>;
}
export function ExhibitionRegisterPage() {
  return <RegisterShell title="공모 등록"><MyExhibitionsSection createOnly /></RegisterShell>;
}
export function ShowRegisterPage() {
  return <RegisterShell title="전시 등록"><MyShowsSection createOnly /></RegisterShell>;
}
