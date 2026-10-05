import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Heart, Building2, X, Plus, Check, XCircle,
  Camera, Eye, Search, Calendar, Edit3, Trash2, Instagram, Save, AlertTriangle, Ticket,
  ChevronUp, Megaphone, ClipboardList, MapPin, Phone, Mail, User as UserIcon, FileArchive, ExternalLink, Wrench, Inbox, ListChecks, ArrowLeft, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, exhibitionTypeLabels, getDday, validateExhibitionDates, capacityError, CAPACITY_MAX, getShowStatus, showStatusLabels, displayName, nameWithNickname, compressImage, MAX_IMAGE_BYTES, formatPhoneNumber, roleLabel, cn } from '@/lib/utils';
import { stageOf, applicationStatusView, galleryNextTask, artistNextTask, ddayText, type TaskTarget } from '@/lib/flowLabels';
import TaskLine from '@/components/flow/TaskLine';
import { scheduleSummary } from '@/lib/scheduleSummary';
import StatusChip from '@/components/flow/StatusChip';
import Notice from '@/components/flow/Notice';
import DraftNotice from '@/components/flow/DraftNotice';
import { savedAtLabel } from '@/lib/formDraft';
import ProgressSteps from '@/components/flow/ProgressSteps';
import Disclosure from '@/components/flow/Disclosure';
import PageTabBar from '@/components/shared/PageTabBar';
import { FormSection, FormField } from '@/components/flow/FormParts';
import { formInputCls } from '@/lib/formStyles';
import ImageUpload, { MultiImageUpload } from '@/components/shared/ImageUpload';
import { groupMyExhibitions, defaultBucket, isRejected, nextSchedule, MY_EXHIBITION_TABS, MY_EXHIBITION_EMPTY, type MyExhibitionBucket } from '@/lib/myExhibitions';
import PortfolioMaker from '@/components/portfolio-maker/PortfolioMaker';
import HomepageEditor from '@/components/homepage-edit/HomepageEditor';
import HomepageAddressField from '@/components/shared/HomepageAddressField';
import ArtistHomepageLine from '@/components/shared/ArtistHomepageLine';
import { normalizeHandle, suggestHandle, validateHandle } from '@/lib/handle';
import ArtistOperationPanel from '@/components/operation/ArtistOperationPanel';
import { OperationBody } from '@/pages/OperationPage';
import Thumb from '@/components/shared/Thumb';
import { myPageTabs, resolveTab, aliasTab, tabHref } from '@/lib/myPageMenu';
import { editHref } from '@/lib/homepageEdit';
import JoinCodeInput from '@/components/shared/JoinCodeInput';
import ApplicationContent from '@/components/shared/ApplicationContent';
import ApplicantManager from '@/components/shared/ApplicantManager';
import CustomQuestionsEditModal, { CustomQuestionBuilder, sanitizeCustomFields } from '@/components/shared/CustomQuestionsEditor';
import { EditableText, HeroImageEdit } from '@/components/shared/EditableField';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useUnsavedChanges, confirmDiscardUnsaved } from '@/hooks/useUnsavedChanges';
import { DeleteRequestDialog, DeleteRequestLine } from '@/components/shared/DeleteRequest';
import RichText from '@/components/shared/RichText';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import { richTextLength } from '@/lib/richText';
import { checkDeletable, useMyDeleteRequests } from '@/hooks/useDeleteRequests';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ConfirmDeleteButton from '@/components/shared/ConfirmDeleteButton';
import ArtworkDetailModal, { InviteModal } from '@/components/shared/ArtworkDetailModal';
import InviteApplyModal from '@/components/shared/InviteApplyModal';
import { stageArtLookWorks, portfolioArtLookWorks, readArtLookMessage, COMPOSE_STATE_KEY, ARTLOOK_EMBED_URL } from '@/lib/artlook';
import { useFillHeight } from '@/hooks/useFillHeight';
import HostedExhibitionsSection from '@/components/admin/HostedExhibitionsSection';
import KanbanSection from '@/components/admin/KanbanSection';
import AdminStatsSection from '@/components/admin/AdminStatsSection';
import AdManageSection from '@/components/admin/AdManageSection';
import HostBadge from '@/components/shared/HostBadge';
import ExhibitionScopePicker from '@/components/shared/ExhibitionScopePicker';
import type { Favorite, Portfolio, Gallery, Exhibition, Show, ArtistEntry, CustomField, ExploreImage, ExhibitionInvite } from '@/types';

const regions = ['SEOUL', 'INCHEON', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'DAEGU', 'BUSAN', 'ULSAN'];

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
  rejectReason?: string | null;
  deadlineStart?: string | null;
  deadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  recruitmentClosed?: boolean;
  confirmed?: boolean;
  ended?: boolean;
  settlementRequestedAt?: string | null;
  settledAt?: string | null;
  /** 서버가 계산한 종료(정산 완료 또는 전시 종료 20일 경과) */
  closed?: boolean;
  gallery?: { id: number; name: string };
  stage: { key: string; label: string; tone: OperationTone };
  nextAction: { label: string; description: string; route: string };
  counts: {
    applications: { total: number; submitted: number; reviewed: number; accepted: number; rejected: number };
    submissions: { required: number; submitted: number; complete: number };
    sales: { total: number };
    settlement: { total: number; pending: number; approved: number; issue: number };
  };
}

const operationDate = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('ko', { month: 'short', day: 'numeric' });
};

const operationRange = (start?: string | null, end?: string | null) => {
  if (!start && !end) return '-';
  if (!start) return operationDate(end);
  if (!end) return operationDate(start);
  return `${operationDate(start)} - ${operationDate(end)}`;
};

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
    return tab === 'my-exhibitions-classic' ? 'my-exhibitions' : (tab || 'profile');
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
    const t = rawTab ?? 'profile';
    if (t !== activeTab) setActiveTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const selectTab = (id: string) => {
    setActiveTab(id);
    setSearchParams(id === 'profile' ? {} : { tab: id }, { replace: true });
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

  if (!user) return null;

  // 메뉴 정의는 lib/myPageMenu.ts 하나뿐 — 우측 사이드바(Layout)·Navbar 모바일 메뉴와 같은 것을 쓴다
  const tabs = myPageTabs(user.role);

  // 역할과 맞지 않는 ?tab= 값으로 진입하면 빈 화면이 되므로 첫 유효 탭(프로필)으로 폴백.
  // 사이드바도 같은 resolveTab 을 써야 강조와 내용이 어긋나지 않는다.
  const currentTab = resolveTab(user.role, activeTab);
  /**
   * 한 가지 일에 집중하는 화면인가 — 작가의 홈페이지 편집 · 포트폴리오 PDF 만들기(2026-10-03).
   * 둘 다 **아래에 붙는 바**가 있고 첫 화면에 결과물이 보여야 하는 화면이다. 프로필 카드(240px)·가로 탭바를 위에 두면
   * 포트폴리오 화면의 미리보기가 첫 화면 밖으로 밀렸다(PC y894 · 휴대폰 y1375).
   */
  const focused = (currentTab === 'homepage-edit' || currentTab === 'portfolio' || currentTab === 'artlook') && user.role === 'ARTIST';
  /** 화면을 끝까지 채우는 도구 — ArtLook(2026-10-04). 휴대폰은 좌우 여백도 없이 가장자리까지(미리보기를 한 치라도 더) */
  const fill = currentTab === 'artlook' && user.role === 'ARTIST';

  return (
    <div className={cn('max-w-7xl mx-auto', fill ? 'px-0 sm:px-6 lg:px-8 sm:pt-6' : 'px-6 md:px-12', !fill && (focused ? 'pt-6 md:pt-10' : 'py-10 md:py-16'))}>
      {/* 'My Page' 제목은 두지 않는다 — 우측 사이드바가 현재 위치를 알려주고,
          각 탭이 제 이름을 갖는다(예: 포트폴리오 탭의 PortFolio).
          로그아웃도 여기 없다 — Navbar 우측으로 일원화 */}
      {/*
        홈페이지 편집 화면은 **그 일만 하는 화면**이다(2026-10-02) — 프로필 카드(240px)와 가로 탭바를 그 위에 두면
        가입 직후 도착한 작가의 첫 화면이 작품 올리기가 아니라 내 이메일이 된다. 다른 메뉴는 상단 [메뉴]·우측 사이드바로 간다.
      */}
      {!focused && <ProfileCard />}

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
            return tab.linkTo ? (
              <Link key={tab.id} to={tabHref(tab, user.id)} className={cls}>{name}</Link>
            ) : (
              <button key={tab.id} onClick={() => selectTab(tab.id)} className={cls}>{name}</button>
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
          {currentTab === 'profile' && <ProfileSection />}
          {/* 홈페이지 편집 — 메뉴에 없다. 공개 작가 페이지의 [수정](주인만)에서 들어온다 */}
          {currentTab === 'homepage-edit' && user.role === 'ARTIST' && <HomepageEditor />}
          {/* 포트폴리오 PDF 만들기 — 화면은 `components/portfolio-maker/`(2026-10-03 개편) */}
          {currentTab === 'portfolio' && user.role === 'ARTIST' && <PortfolioMaker />}
          {currentTab === 'artlook' && user.role === 'ARTIST' && <ArtLookSection />}
          {currentTab === 'favorites' && (user.role === 'ARTIST' || user.role === 'VISITOR') && <FavoritesSection />}
          {currentTab === 'scraps' && user.role === 'GALLERY' && <ArtworkScrapsSection />}
          {currentTab === 'applications' && user.role === 'ARTIST' && <ApplicationsSection />}
          {currentTab === 'my-galleries' && user.role === 'GALLERY' && <MyGalleriesSection />}
          {currentTab === 'my-exhibitions' && user.role === 'GALLERY' && <MyExhibitionsSection />}
          {currentTab === 'my-shows' && user.role === 'GALLERY' && <MyShowsSection />}
          {currentTab === 'stats' && user.role === 'ADMIN' && <AdminStatsSection />}
          {currentTab === 'approvals' && user.role === 'ADMIN' && <ApprovalsSection />}
          {currentTab === 'hosted-exhibitions' && user.role === 'ADMIN' && <HostedExhibitionsSection />}
          {currentTab === 'hero-manage' && user.role === 'ADMIN' && <HeroManageSection />}
          {currentTab === 'benefit-manage' && user.role === 'ADMIN' && <BenefitManageSection />}
          {currentTab === 'gotm-manage' && user.role === 'ADMIN' && <GotmManageSection />}
          {currentTab === 'ad-manage' && user.role === 'ADMIN' && <AdManageSection />}
          {currentTab === 'report-manage' && user.role === 'ADMIN' && <ReportManageSection />}
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
      const file = await compressImage(rawFile);
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`이미지 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
        return;
      }
      const formData = new FormData();
      formData.append('image', file);
      const uploadRes = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const avatarUrl = uploadRes.data.url;
      await api.put('/auth/me/avatar', { avatar: avatarUrl });
      updateUser({ avatar: avatarUrl });
      toast.success('프로필 사진이 변경되었습니다.');
    } catch {
      toast.error('프로필 사진 변경에 실패했습니다.');
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
  const { data: portfolio, isLoading } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then(r => r.data),
  });
  const images = useMemo(() => portfolio?.images ?? [], [portfolio]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 아이폰 SE(568px)도 하단 탭바 위에서 끝나게 — 그보다 낮은 화면(가로로 눕힌 휴대폰)은 바깥 페이지가 스크롤된다
  const height = useFillHeight(boxRef, { min: 340 });

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
        // 글쓰기 칸이 사진을 실은 채로 열린다(FeedPage Composer 가 state 를 한 번 읽고 지운다)
        navigate('/feed', { state: { [COMPOSE_STATE_KEY]: [data.url] } });
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
      if (msg.type === 'goto') navigate(msg.to === 'size' ? editHref('works', { info: true, work: msg.id }) : editHref('works'));
      else void toStory(msg.blob, msg.name);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  return (
    <div>
      {/* 제목 줄 — 화면 이름은 좌측 상단(로고 색 규칙). 휴대폰은 한 줄로 */}
      <div className="flex min-w-0 items-baseline gap-2.5 px-4 py-2 sm:px-0 sm:pb-3 sm:pt-0">
        <h2 className="shrink-0 text-lg sm:text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900">
          Art<span className="text-accent">Look</span>
        </h2>
        <p className="min-w-0 truncate text-sm text-gray-500">작품을 액자와 공간에 걸어 SNS에 올릴 이미지를 만듭니다</p>
      </div>
      {/* 작품이 0점이어도 iframe 은 그린다 — ArtLook 이 데모 작품으로 체험하게 하고, 그 안에서 [작품 올리기]로 보낸다(규칙 36) */}
      <div
        ref={boxRef}
        style={height ? { height } : undefined}
        className="h-[70vh] overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border"
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


// ========== Gallery: 관심 작품 (하트로 모은 작품 → 작가 초대) ==========
/*
  갤러리도 이제 **하트(좋아요)** 로 작품을 모은다(예전의 비공개 스크랩·메모 보드는 없앴다).
  여기 모인 작품의 **작가에게 전시 초대를 보내는** 스카우팅 창구다.
  ⚠️ 하트는 작가에게 보인다(스크랩과 달리 비공개가 아니다) — 관심을 숨길 이유가 없다는 판단.
  데이터는 작가 [찜 목록]의 '좋아요한 작품'과 같은 `/explore/my-likes` 를 쓴다.
*/
function ArtworkScrapsSection() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExploreImage | null>(null);
  const [invite, setInvite] = useState<{ id: number; name: string } | null>(null);

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
      {/* 개수·'저장 사실 비공개' 문구 대신, 이 화면이 무엇을 위한 곳인지 안내한다 */}
      <p className="text-sm text-gray-500 mb-4">
        저장한 작품의 작가에게는 전시 초대를 보낼 수 있습니다.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <div className="flex items-center justify-between gap-2 p-3">
              <button
                onClick={() => navigate(`/portfolio/${img.artist.id}`)}
                className="min-w-0 truncate text-sm font-medium text-gray-900 hover:underline cursor-pointer"
              >
                {displayName(img.artist)}
              </button>
              <button
                onClick={() => setInvite({ id: img.artist.id, name: displayName(img.artist) })}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-gray-950 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 cursor-pointer"
              >
                <Mail size={13} /> 전시 초대
              </button>
            </div>
          </div>
        ))}
      </div>

      {invite && (
        <InviteModal artistId={invite.id} artistName={invite.name} onClose={() => setInvite(null)} />
      )}

      <AnimatePresence>
        {selected && (
          <ArtworkDetailModal image={selected} onClose={() => setSelected(null)} onUpdate={setSelected} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ========== Gallery: 공모에 작가 초대 (내 공모 → 지원자 관리 패널) ==========
/*
  '공모 고정 + 작가 선택' 초대. 작품 모달의 InviteModal(작가 고정 + 공모 선택)과 방향만 반대다.
  초대 대상은 **관심 작품(하트)을 저장한 작가** — 아무나 검색해 부르는 게 아니라, 작품을 보고 담아둔 작가다.
  모집 마감·정원 초과·중복 초대는 서버가 막고, 그 사유를 토스트로 보여준다.
*/
function ExhibitionInviteModal({ exhibitionId, exhibitionTitle, onClose }: { exhibitionId: number; exhibitionTitle: string; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery<{ images: ExploreImage[] }>({
    queryKey: ['my-likes'],
    queryFn: () => api.get('/explore/my-likes', { params: { limit: 60 } }).then(r => r.data),
  });

  // 같은 작가의 작품이 여러 점이면 한 번만 (초대는 작가 단위다)
  const artists = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; avatar?: string | null; url: string }>();
    for (const img of data?.images ?? []) {
      if (!seen.has(img.artist.id)) {
        seen.set(img.artist.id, { id: img.artist.id, name: displayName(img.artist), avatar: img.artist.avatar, url: img.url });
      }
    }
    return [...seen.values()];
  }, [data]);

  const inviteMutation = useMutation({
    mutationFn: () => api.post(`/exhibitions/${exhibitionId}/invite`, { artistId: selected, message: message.trim() || undefined }),
    onSuccess: () => {
      toast.success('초대를 보냈습니다.');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '초대에 실패했습니다.'),
  });

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-medium text-gray-900">작가 초대</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 cursor-pointer" aria-label="닫기"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4 truncate">{exhibitionTitle}</p>

        {isLoading ? (
          <p className="text-sm text-gray-400 py-6 text-center">불러오는 중…</p>
        ) : artists.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center leading-relaxed">
            초대할 작가가 없습니다.<br />
            <span className="text-xs">둘러보기에서 마음에 드는 작품에 <b>하트</b>를 누르면<br />그 작가를 여기로 초대할 수 있습니다.</span>
          </p>
        ) : (
          <>
            {/* 관심 작품(하트)을 저장한 작가만 초대 대상이라는 걸 명시 */}
            <p className="mb-2 text-xs text-gray-500">관심 작품(하트)을 저장한 작가를 초대할 수 있습니다.</p>
            <div className="space-y-1.5 max-h-52 overflow-y-auto mb-4">
              {artists.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-sm border transition-colors cursor-pointer ${
                    selected === a.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Thumb src={a.url} size="list" alt="" className="h-9 w-9 rounded object-contain bg-gray-50 shrink-0" loading="lazy" />
                  <span className="min-w-0 truncate text-left">{a.name}</span>
                </button>
              ))}
            </div>

            <label className="block text-xs text-gray-500 mb-1.5">메시지 (선택, 300자)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, 300))}
              rows={3}
              placeholder="작품 잘 봤습니다. 함께하고 싶습니다."
              className="w-full border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-900"
            />
            <p className="mt-3 text-xs text-gray-400">
              초대한 작가는 <span className="text-gray-600">지원서 없이 바로 참가</span>합니다. 정원·마감은 그대로 지켜집니다.
            </p>

            <button
              onClick={() => inviteMutation.mutate()}
              disabled={!selected || inviteMutation.isPending}
              className="w-full mt-4 py-2.5 bg-gray-900 text-white text-sm disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
            >
              {inviteMutation.isPending ? '보내는 중…' : '초대 보내기'}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/** 참고용 내용을 접어두는 상자 — ArtistOperationPanel 의 블록과 같은 모양으로 맞춘다 */
// ========== Artist: 내 전시 (지원 → 선정 → 출품 자료 → 전시 → 정산) ==========
// 분류 규칙은 lib/myExhibitions.ts, 단계·상태 이름과 할 일은 lib/flowLabels.ts
function ApplicationsSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  // null = 아직 자동 선택 전. 데이터가 온 뒤 '내용이 있는 첫 탭'으로 한 번만 정한다
  // (전체 탭을 없앴으므로 기본값을 고정하면 가진 게 있는데도 빈 화면이 될 수 있다)
  const [statusFilter, setStatusFilter] = useState<MyExhibitionBucket | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  /** 카드의 할 일 줄을 눌렀을 때 펼칠 구역(출품 자료·정산) */
  const [focus, setFocus] = useState<{ appId: number; target: TaskTarget; seq: number } | null>(null);
  // 알림에서 온 전시(`?ex=`) — 한 번만 열고 그 뒤엔 사용자가 접었다 폈다 하도록 둔다
  const deepLinkExId = Number(searchParams.get('ex')) || null;
  const deepLinkDone = useRef(false);

  // 받은 초대 — 예전 [받은 초대] 탭이 여기 첫 탭으로 들어왔다 (목록 API 는 그대로)
  const { data: inviteData, isFetched: invitesFetched } = useQuery<{ invites: any[] }>({
    queryKey: ['received-invites'],
    queryFn: () => api.get('/exhibitions/invites/received').then(r => r.data),
  });
  const invites = (inviteData?.invites ?? []).filter((i: any) => !i.applied && !i.closed);

  /* 초대 수락 = **지원 없이 바로 참가**. 갤러리가 이미 작품을 보고 부른 것이라
     지원서를 다시 쓰게 하지 않는다(서버가 포트폴리오에서 채운다). 곧바로 '진행 중' 탭으로 옮겨간다. */
  const acceptInvite = useMutation({
    mutationFn: (id: number) => api.post(`/exhibitions/invites/${id}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['received-invites'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setStatusFilter('ONGOING');
      toast.success('전시에 참여하게 되었습니다. 출품 자료를 준비해 주세요.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '참여 처리에 실패했습니다.'),
  });
  /* 거절은 확인을 거친다(2026-09-19) — 유니크 제약 때문에 **갤러리가 같은 작가를 다시 초대할 수 없어** 오터치가 영구 손실이다.
     [참여하기] 바로 옆 버튼이라 더 그렇다. */
  const [decliningInviteId, setDecliningInviteId] = useState<number | null>(null);
  const declineInvite = useMutation({
    mutationFn: (id: number) => api.patch(`/exhibitions/invites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['received-invites'] });
      toast.success('초대를 거절했습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '처리에 실패했습니다.'),
  });

  const { data: apps = [], isLoading, isError, isFetched: appsFetched } = useQuery<any[]>({
    queryKey: ['my-applications'],
    queryFn: () => api.get('/exhibitions/my-applications').then(r => r.data),
  });

  // 사용자가 고른 탭은 refetch 가 되돌리면 안 된다 — 그래서 한 번만 정한다
  useEffect(() => {
    /*
      ⚠️ **두 목록이 다 온 뒤에** 정한다(2026-10-03 점검 P2). 초대 목록이 먼저 오면 '지원 0건' 으로 보고 [받은 초대]로 굳어서
      같은 계정이 PC 에선 [진행 중], 휴대폰에선 [받은 초대]로 열렸다.
      초대만 받은 작가(지원 0건)는 [받은 초대] 탭으로 — 예전엔 apps 만 봐서 초대 알림을 눌러 들어와도 "진행 중인 전시가 없습니다" 였다(2026-09-19)
    */
    if (statusFilter !== null || !appsFetched || !invitesFetched) return;
    if (apps.length > 0) setStatusFilter(defaultBucket(apps));
    else if (invites.length > 0) setStatusFilter('INVITED');
  }, [apps, invites.length, statusFilter, appsFetched, invitesFetched]);

  /*
    저장 안 된 출품 자료·정산 입력을 지킨다(2026-10-03 점검 P1) — 카드를 닫거나 다른 카드를 열거나 탭을 바꾸면
    펼친 카드의 입력 칸이 통째로 사라지는데, 이탈 경고(`useUnsavedChanges`)는 **페이지를 떠날 때만** 묻는다.
    그래서 화면 안에서 떼어 내는 동작은 먼저 `confirmDiscardUnsaved()` 를 거친다(같은 확인창 문구).
  */
  const toggleCard = (appId: number) => {
    if (expandedId !== null && !confirmDiscardUnsaved()) return;
    setExpandedId(expandedId === appId ? null : appId);
  };
  const openCardFor = (appId: number, target: TaskTarget) => {
    if (expandedId !== null && expandedId !== appId && !confirmDiscardUnsaved()) return;
    setExpandedId(appId);
    setFocus({ appId, target, seq: Date.now() });
  };

  /*
    알림을 눌러 들어오면(`?ex=<id>`) **그 전시를 펼친 채로** 보여준다.
    목록에서 다시 찾아 누르게 하면 알림으로 보낸 의미가 없다.

    ⚠️ 그 전시가 들어 있는 **탭까지 함께 바꿔야** 한다 — 기본 탭이 다르면 카드가 아예 안 보인다.
    ⚠️ 딱 한 번만(`deepLinkDone`) — refetch 때마다 걸리면 사용자가 접어도 다시 열린다.
  */
  useEffect(() => {
    if (!deepLinkExId || deepLinkDone.current || apps.length === 0) return;
    const target = apps.find((a: any) => a.exhibitionId === deepLinkExId);
    if (!target) return;
    deepLinkDone.current = true;
    const buckets = groupMyExhibitions(apps);
    const bucket = (Object.keys(buckets) as MyExhibitionBucket[]).find(k => buckets[k].some((a: any) => a.id === target.id));
    if (bucket) setStatusFilter(bucket);
    setExpandedId(target.id);
    window.setTimeout(() => document.getElementById(`app-card-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [apps, deepLinkExId]);

  // 거절 확인 — '확인'을 눌러야 목록에서 제거 (그전까지는 '심사 중' 탭에 남는다)
  const ackRejectionMutation = useMutation({
    mutationFn: (appId: number) => api.post(`/exhibitions/applications/${appId}/acknowledge-rejection`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['my-applications'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '처리에 실패했습니다.'),
  });

  if (isError) {
    return <p className="py-8 text-center text-accent">내 전시 목록을 불러오는 중 오류가 발생했습니다.</p>;
  }

  // 초대 목록도 기다린다 — 먼저 그리면 탭이 [진행 중] → [받은 초대] 로 한 번 튄다
  if (isLoading || !invitesFetched) return <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />;

  // 거절을 '확인'한 지원만 숨김 (확인 전 거절은 목록에 표시 → 확인 버튼 노출)
  const visibleApps = apps.filter((a: any) => !(isRejected(a) && a.rejectionAckedAt));

  const buckets = groupMyExhibitions(visibleApps);
  const activeTab: MyExhibitionBucket = statusFilter ?? (visibleApps.length === 0 && invites.length > 0 ? 'INVITED' : defaultBucket(visibleApps));
  const filteredApps = buckets[activeTab];

  const counts: Record<MyExhibitionBucket, number> = {
    INVITED: invites.length,
    REVIEWING: buckets.REVIEWING.length,
    ONGOING: buckets.ONGOING.length,
    CLOSED: buckets.CLOSED.length,
  };
  const empty = visibleApps.length === 0 && invites.length === 0;

  // 초대 코드 입력은 드물게 쓰는 입구라 한 줄로 접어 둔다 — 예전엔 목록 **맨 위** 큰 상자라 모든 작가가
  // "이걸 먼저 해야 하나?" 로 읽었다. 목록이 비어 있으면(코드를 받고 막 가입한 작가의 첫 화면) 펼쳐 둔다.
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
        <div>
          <h2 className="text-2xl font-semibold text-gray-950">내 전시</h2>
          <p className="mt-1 text-sm text-gray-500">지원한 공모와 참여하는 전시를 여기서 이어서 진행해요.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <p className="text-sm text-gray-600">아직 지원하거나 참여한 전시가 없어요.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-400">모집공고에서 지원하면, 선정 결과부터 출품 자료 제출·정산 확인까지 여기서 이어서 할 수 있어요.</p>
          <button type="button" onClick={() => navigate('/exhibitions')} className="mt-5 inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50">
            모집공고 보기 <ArrowRight size={14} aria-hidden />
          </button>
        </div>
        {joinCode}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-gray-950">내 전시</h2>
        <p className="mt-1 text-sm text-gray-500">지원한 공모와 참여하는 전시를 여기서 이어서 진행해요.</p>
      </div>

      {/* 진행 상태 탭 — 받은 초대 / 심사 중 / 진행 중 / 종료 */}
      <PageTabBar<MyExhibitionBucket>
        sticky={false}
        idPrefix="my-applications"
        label="내 전시 분류"
        active={activeTab}
        onSelect={(t) => {
          if (t === activeTab) return;
          // 펼친 카드가 이 탭에 있으면 탭을 바꾸는 순간 입력이 사라진다
          if (expandedId !== null && !confirmDiscardUnsaved()) return;
          setExpandedId(null);
          setStatusFilter(t);
        }}
        tabs={MY_EXHIBITION_TABS.map(t => ({ id: t.key, label: t.label, count: counts[t.key] || undefined }))}
      />

      <ConfirmDialog
        open={decliningInviteId !== null}
        title="초대 거절"
        message="이 초대를 거절합니다. 거절하면 같은 공모에 다시 초대받을 수 없습니다."
        confirmText="거절"
        variant="danger"
        onConfirm={() => { if (decliningInviteId !== null) declineInvite.mutate(decliningInviteId); setDecliningInviteId(null); }}
        onCancel={() => setDecliningInviteId(null)}
      />

      {/* 받은 초대 — 카드 얼개는 아래 지원 카드와 같게 두되, 버튼만 [참여하기]/[거절] 이다 */}
      {activeTab === 'INVITED' ? (
        invites.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">{MY_EXHIBITION_EMPTY.INVITED}</p>
        ) : invites.map((inv: any) => {
          const ex = inv.exhibition ?? {};
          const deadlineLabel = ddayText('마감', ex.deadline);
          return (
            <article key={inv.id} className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip variant="attention">초대</StatusChip>
                    {deadlineLabel && <span className="text-xs font-medium tabular-nums text-gray-500">{deadlineLabel}</span>}
                  </div>
                  <button type="button" onClick={() => navigate(`/exhibitions/${ex.id}`)}
                    className="mt-3 block max-w-full truncate text-left text-xl font-semibold text-gray-950 hover:underline">
                    {ex.title}
                  </button>
                  <p className="mt-1 text-sm text-gray-500">{ex.gallery?.name || '아트링크'}</p>
                </div>
              </div>

              {/* 갤러리가 적어 보낸 말 — 초대에서 가장 중요한 내용이라 접지 않는다 */}
              {inv.message && (
                <p className="mt-4 whitespace-pre-wrap break-keep rounded-xl bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700 [overflow-wrap:anywhere]">
                  {inv.message}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => acceptInvite.mutate(inv.id)} disabled={acceptInvite.isPending}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                  <Check size={15} aria-hidden /> 참여하기
                </button>
                <button type="button" onClick={() => setDecliningInviteId(inv.id)} disabled={declineInvite.isPending}
                  className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  거절
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                참여하면 지원서 없이 바로 참가자로 등록되고, 약력·작품은 홈페이지에서 가져와요.
              </p>
            </article>
          );
        })
      ) : filteredApps.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">{MY_EXHIBITION_EMPTY[activeTab]}</p>
      ) : (
        filteredApps.map((app: any) => {
          const isExpanded = expandedId === app.id;
          const ex = app.exhibition ?? {};
          const accepted = app.status === 'ACCEPTED';
          const stage = accepted ? stageOf(ex) : null;
          const statusView = !accepted ? applicationStatusView(app.status, 'artist') : null;
          const rows = activeTab === 'ONGOING' ? nextSchedule(ex, !!app.submissionComplete, getDday) : [];
          const task = artistNextTask({
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
          });
          const taskTarget = task?.target ?? null;
          const goTask = taskTarget && accepted
            ? () => openCardFor(app.id, taskTarget)
            : undefined;

          /* 갤러리 [내 공모] 카드와 **같은 얼개**다 — 칩·제목·버튼, 할 일 줄, 일정, 펼치면 작업 영역. */
          return (
            <article key={app.id} id={`app-card-${app.id}`} className="min-w-0 scroll-mt-24 rounded-2xl border border-gray-200 bg-white">
              {/* min-w-0 필수 — 없으면 제목 min-content 가 컬럼을 밀어 truncate 가 무력해진다 */}
              <div className="min-w-0 p-5 md:p-6">
                {/* 버튼은 **어느 폭에서든 카드 우측 상단**. 제목은 min-w-0 + truncate 로 줄어든다. */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {stage && <StatusChip variant={stage.variant}>{stage.label}</StatusChip>}
                      {statusView && <StatusChip variant={statusView.variant}>{statusView.label}</StatusChip>}
                    </div>
                    <button
                      type="button"
                      onClick={() => { if (confirmDiscardUnsaved()) navigate(`/exhibitions/${app.exhibitionId}`); }}
                      className="mt-1.5 flex min-h-[44px] max-w-full items-center text-left text-xl font-semibold text-gray-950 hover:underline"
                    >
                      <span className="truncate">{ex.title}</span>
                    </button>
                    <p className="mt-1 text-sm text-gray-500">
                      {ex.gallery?.name || '아트링크'} · 지원일 {new Date(app.createdAt).toLocaleDateString('ko')}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {accepted ? (
                      <button
                        type="button"
                        onClick={() => toggleCard(app.id)}
                        aria-expanded={isExpanded}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800"
                      >
                        {isExpanded ? <>닫기 <ChevronUp size={14} aria-hidden /></> : <><ClipboardList size={14} aria-hidden /> 전시 관리</>}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleCard(app.id)}
                        aria-expanded={isExpanded}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Eye size={14} aria-hidden /> {isExpanded ? '닫기' : '지원서 보기'}
                      </button>
                    )}
                    {/* 미선정: '확인'을 눌러야 목록에서 사라진다 */}
                    {app.status === 'REJECTED' && (
                      <button
                        type="button"
                        onClick={() => ackRejectionMutation.mutate(app.id)}
                        disabled={ackRejectionMutation.isPending}
                        className="min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        확인
                      </button>
                    )}
                  </div>
                </div>

                {/* 지금 할 일 — 할 일이 있을 때만(작가 카드엔 일정 줄이 있어 없는 할 일을 또 적으면 잔소리다) */}
                {task && <TaskLine task={task} onClick={goTask} />}

                {app.status === 'REJECTED' && (
                  <p className="mt-4 text-sm text-gray-600">이번 공모에서는 선정되지 않았어요. [확인]을 누르면 목록에서 사라져요.</p>
                )}

                {/*
                  일정 줄은 진행 중 탭에서 **항상** 그린다 — 남은 일정이 없을 때 줄째로 빼면 카드 높이가 제각각이 된다.
                  남은 일정이 없으면 대신 전시 기간을 적는다. 마감이 지났어도 줄을 지우지 않는다(늦었어도 내야 하는 일).
                */}
                {(activeTab === 'ONGOING' || rows.length > 0) && (
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3">
                    {rows.length > 0 ? rows.map((r, i) => (
                      <span key={i} className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', r.tone === 'urgent' ? 'font-medium text-accent' : r.tone === 'done' ? 'text-gray-500' : 'text-gray-600')}>
                        {r.tone === 'urgent' && <AlertTriangle size={11} className="shrink-0" aria-hidden />}
                        {r.tone === 'done' && <Check size={11} className="shrink-0" aria-hidden />}
                        {r.label}
                        {r.dday && <b className="tabular-nums">{r.dday}</b>}
                        <span className="tabular-nums text-gray-400">({r.date})</span>
                      </span>
                    )) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-gray-500">
                        <Calendar size={11} className="shrink-0 text-gray-400" aria-hidden />
                        전시 기간
                        <span className="tabular-nums text-gray-400">
                          ({[ex.exhibitStartDate, ex.exhibitDate].filter(Boolean).map((v: string) => new Date(v).toLocaleDateString('ko', { month: 'numeric', day: 'numeric' })).join(' ~ ') || '미정'})
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="border-t border-gray-100 px-5 md:px-6">
                  {/* 할 일이 맨 위 — 지원서(수십 줄)를 먼저 두면 정작 해야 할 게 아래로 밀린다 */}
                  <div className="divide-y divide-gray-100">
                    {accepted && (
                      <ArtistOperationPanel
                        exhibitionId={app.exhibitionId}
                        exhibition={ex}
                        submissionComplete={app.submissionComplete}
                        mySettlementStatus={app.mySettlementStatus ?? null}
                        focus={focus && focus.appId === app.id ? { target: focus.target, seq: focus.seq } : null}
                      />
                    )}
                    {accepted ? (
                      <Disclosure title="내가 낸 지원서">
                        <ApplicationContent app={app} customFields={ex.customFields} />
                      </Disclosure>
                    ) : (
                      <div className="py-5">
                        <p className="mb-3 text-sm font-semibold text-gray-950">내가 낸 지원서</p>
                        <ApplicationContent app={app} customFields={ex.customFields} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })
      )}

      <div className="border-t border-gray-100 pt-3">{joinCode}</div>
    </div>
  );
}

// ========== Gallery: 내 갤러리 ==========
// 삭제 이중확인 모달 — "삭제"를 입력해야 진행 (갤러리/공모/전시 공용)
function DeleteConfirmModal({ open, name, description, onConfirm, onCancel, pending }: { open: boolean; name: string; description: string; onConfirm: () => void; onCancel: () => void; pending?: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">삭제 확인</h3>
        <p className="text-sm text-gray-600 mt-2"><b>{name}</b> {description}</p>
        <p className="text-sm text-gray-700 mt-3">계속하려면 아래에 <b className="text-accent">삭제</b> 를 입력하세요.</p>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="삭제"
          autoFocus
          className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500">취소</button>
          <button
            onClick={onConfirm}
            disabled={text.trim() !== '삭제' || pending}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >삭제</button>
        </div>
      </div>
    </div>
  );
}

function MyGalleriesSection({ createOnly = false }: { createOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { name: '', address: '', phone: '', description: '', region: 'SEOUL', ownerName: '', mainImage: '', email: '', instagramUrl: '' };
  const [form, setForm] = useState(emptyForm);
  const [galleryTerms, setGalleryTerms] = useState('');
  const [galleryAgreed, setGalleryAgreed] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | null>(null);
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
  const { pending: draftPending, savedAt: draftSavedAt, resume: resumeDraft, discard: discardDraft, save: saveDraft, clear: clearDraft, autoSave } = useFormDraft<typeof emptyForm>('draft_gallery_form');

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

  // 약관 텍스트 로드
  useEffect(() => {
    if (showForm) {
      fetch('/terms/gallery-registration.txt')
        .then(r => { if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error(); return r.text(); })
        .then(t => { if (!t.trimStart().startsWith('<!')) setGalleryTerms(t); })
        .catch(() => setGalleryTerms('약관을 불러올 수 없습니다.'));
    }
  }, [showForm]);

  // ⚠️ `.catch(() => [])` 로 삼키지 말 것 — 서버 오류가 "등록된 갤러리가 없습니다"(성공한 빈 목록)로 둔갑한다(감사 M18)
  const { data: galleries = [], isError: galleriesError } = useQuery<any[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/galleries', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
      setShowForm(false);
      setForm(emptyForm);
      setGalleryAgreed(false);
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

      {/* 등록 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-sm">갤러리 등록 요청</h4>
            <span className="flex items-center gap-3">
              {draftSavedAt && <span className="text-xs text-gray-400">{savedAtLabel(draftSavedAt)} 저장됨</span>}
              <button onClick={() => {
                if (saveDraft(form)) toast.success('임시저장했어요. 이 브라우저에 남아 있어요.');
                else toast.error(draftPending ? '작성하던 내용을 먼저 [이어서 쓰기] 또는 [새로 쓰기]로 정해 주세요.' : '임시저장하지 못했어요.');
              }} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">
                <Save size={12} /> 임시저장
              </button>
            </span>
          </div>
          {draftPending && (
            <DraftNotice
              title="작성하던 갤러리 등록 요청이 있어요"
              summary={draftPending.data.name}
              savedAt={draftPending.savedAt}
              onResume={() => { const d = resumeDraft(); if (d) setForm({ ...emptyForm, ...d }); }}
              onDiscard={discardDraft}
              className="bg-white"
            />
          )}
          {/* WYSIWYG: 실제 갤러리 상세 페이지 모습으로 편집 */}
          <p className="text-xs text-gray-400">아래는 실제 갤러리 상세 페이지에 보일 모습입니다. 칸을 눌러 바로 입력하세요. (제출 후 관리자 승인 시 공개)</p>
          <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
            <HeroImageEdit value={form.mainImage} onChange={(url) => setForm({...form, mainImage: url})} onRemove={() => setForm({...form, mainImage: ''})} className="w-full aspect-[4/3]" label="갤러리 대표 이미지" />
            <div className="p-5 space-y-3">
              <select value={form.region} onChange={e => setForm({...form, region: e.target.value})} className="text-xs px-2.5 py-1 bg-gray-100 rounded-full text-gray-600 cursor-pointer focus:outline-none">
                {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
              </select>
              <EditableText value={form.name} onChange={v => { setForm({...form, name: v}); clearGalleryError('name'); }} placeholder="갤러리명" error={galleryFormErrors.has('name')} className="text-2xl font-serif text-gray-900" />
              <div className="space-y-1 text-sm text-gray-600">
                <div className="flex items-center gap-2"><MapPin size={15} className="text-gray-400 shrink-0" /><EditableText value={form.address} onChange={v => { setForm({...form, address: v}); clearGalleryError('address'); }} placeholder="주소" error={galleryFormErrors.has('address')} className="text-sm flex-1" /></div>
                <div className="flex items-center gap-2"><Phone size={15} className="text-gray-400 shrink-0" /><EditableText value={form.phone} onChange={v => { setForm({...form, phone: v}); clearGalleryError('phone'); }} placeholder="전화번호" error={galleryFormErrors.has('phone')} className="text-sm flex-1" /></div>
                <div className="flex items-center gap-2"><UserIcon size={15} className="text-gray-400 shrink-0" /><EditableText value={form.ownerName} onChange={v => { setForm({...form, ownerName: v}); clearGalleryError('ownerName'); }} placeholder="대표자명" error={galleryFormErrors.has('ownerName')} className="text-sm flex-1" /></div>
                <div className="flex items-center gap-2"><Mail size={15} className="text-gray-400 shrink-0" /><EditableText value={form.email} onChange={v => setForm({...form, email: v})} placeholder="이메일 (선택)" className="text-sm flex-1" /></div>
                <div className="flex items-center gap-2"><Instagram size={15} className="text-gray-400 shrink-0" /><EditableText value={form.instagramUrl} onChange={v => setForm({...form, instagramUrl: v})} placeholder="인스타그램 주소 (선택)" className="text-sm flex-1" /></div>
              </div>
              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-400 mb-1">소개</p>
                <EditableText multiline rows={3} value={form.description} onChange={v => { setForm({...form, description: v}); clearGalleryError('description'); }} placeholder="갤러리 한줄 소개" error={galleryFormErrors.has('description')} className="text-sm text-gray-700" />
              </div>
            </div>
          </div>
          {/* 약관 동의 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-40 overflow-y-auto p-3 bg-white text-xs text-gray-600 whitespace-pre-wrap">{galleryTerms || '약관 로딩 중...'}</div>
            <label className="flex items-center gap-2 p-3 bg-gray-100 border-t border-gray-200 cursor-pointer text-sm">
              <input type="checkbox" checked={galleryAgreed} onChange={e => setGalleryAgreed(e.target.checked)} className="rounded" />
              위 약관에 동의합니다
            </label>
          </div>
          <div className="flex gap-2">
            <button
              disabled={createMutation.isPending || !galleryAgreed}
              onClick={() => {
                // 필수 항목 구체적 검증 + 빨간 테두리 하이라이트 (공모 등록 폼과 동일 UX)
                const missing: string[] = [];
                const errorFields = new Set<string>();
                if (!form.name) { missing.push('갤러리명'); errorFields.add('name'); }
                if (!form.address) { missing.push('주소'); errorFields.add('address'); }
                if (!form.phone) { missing.push('전화번호'); errorFields.add('phone'); }
                if (!form.ownerName) { missing.push('대표자명'); errorFields.add('ownerName'); }
                if (!form.description) { missing.push('소개'); errorFields.add('description'); }
                setGalleryFormErrors(errorFields);
                if (missing.length > 0) {
                  toast.error(
                    () => (
                      <div className="text-sm">
                        <p className="font-medium mb-1">다음 필수 항목을 입력해주세요:</p>
                        {missing.map((m, i) => <p key={i} className="text-accent">• {m}</p>)}
                      </div>
                    ),
                    { duration: 4000 }
                  );
                  return;
                }
                setConfirmAction('submit');
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >{createMutation.isPending ? '등록 중...' : '등록 요청'}</button>
            <button onClick={() => { if (isDirty) { setConfirmAction('cancel'); } else if (createOnly) { navigate(-1); } else { setShowForm(false); setGalleryAgreed(false); setGalleryFormErrors(new Set()); } }} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      {/* 등록 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        title="갤러리 등록"
        message="이 내용으로 갤러리 등록을 요청하시겠습니까?"
        confirmText="등록 요청"
        onConfirm={() => { setConfirmAction(null); createMutation.mutate(form); }}
        onCancel={() => setConfirmAction(null)}
      />
      {/* 취소 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="작성 취소"
        message={'작성 중인 내용이 있습니다. 정말 취소하시겠습니까?\n임시저장된 내용은 유지됩니다.'}
        confirmText="취소하기"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); setShowForm(false); setGalleryAgreed(false); setGalleryFormErrors(new Set()); if (createOnly) navigate(-1); }}
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
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  // 전용 등록 화면(/exhibitions/new)에서는 폼만 연 채로 시작한다.
  useEffect(() => { if (createOnly) setShowForm(true); }, [createOnly]);
  // 항상 '진행 중'으로 시작한다. 선택을 저장해두면 다음에 열었을 때 종료 탭이 떠 있어
  // "내 공모가 다 사라졌다"로 읽힌다 — 필터는 기억하지 않는 편이 안전하다.
  const [exhibitionViewMode, setExhibitionViewMode] = useState<ExhibitionViewMode>(initialViewMode ?? 'active');

  useEffect(() => {
    if (initialViewMode) setExhibitionViewMode(initialViewMode);
  }, [initialViewMode]);
  const emptyExForm = { galleryId: 0, title: '', type: 'SOLO', deadlineStart: '', deadline: '', exhibitStartDate: '', exhibitDate: '', submissionDeadline: '', recruitOnly: false, capacity: 1, region: 'SEOUL', description: '', imageUrl: '', customFields: [] as CustomField[] };
  const [form, setForm] = useState(emptyExForm);
  const [exhibitionTerms, setExhibitionTerms] = useState('');
  const [exhibitionAgreed, setExhibitionAgreed] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'cancel' | null>(null);
  // 미입력 필드 하이라이트 상태
  const [formErrors, setFormErrors] = useState<Set<string>>(new Set());
  /** 카드에서 펼친 곳 — 한 번에 한 카드의 한 탭만(두 탭을 동시에 펴면 카드 하나가 화면 몇 장이 된다) */
  const [openPanel, setOpenPanelRaw] = useState<{ id: number; tab: 'applicants' | 'operation' } | null>(null);
  /**
   * 그 카드에서 한 번 연 탭 — [지원자]↔[운영] 을 오가도 **떼지 않고 숨기기만** 한다(2026-10-03 점검 P1-2).
   * 예전엔 탭을 바꾸면 패널이 통째로 떼어져, 정산 판매가를 적다가 [지원자]를 한 번 눌렀다 오면 입력이 경고 없이 사라졌다.
   * 카드를 접거나 다른 카드를 열 때는 떼어 내므로 그때는 저장 안 된 입력이 있는지 먼저 묻는다(`confirmDiscardUnsaved`).
   */
  const [visitedTabs, setVisitedTabs] = useState<('applicants' | 'operation')[]>([]);
  const setOpenPanel = (next: { id: number; tab: 'applicants' | 'operation' } | null): boolean => {
    const sameCard = !!next && !!openPanel && next.id === openPanel.id;
    if (!sameCard && openPanel && !confirmDiscardUnsaved()) return false;
    setOpenPanelRaw(next);
    setVisitedTabs(prev => (!next ? [] : sameCard ? (prev.includes(next.tab) ? prev : [...prev, next.tab]) : [next.tab]));
    return true;
  };
  /** [운영] 탭에서 열고 스크롤할 구역 — 카드의 할 일 줄을 눌렀을 때 */
  const [opsFocus, setOpsFocus] = useState<{ target: TaskTarget; seq: number } | null>(null);
  // 작가 초대 대상 공모 — 관심 작품(하트)을 저장한 작가를 이 공모에 초대한다
  const [inviteEx, setInviteEx] = useState<{ id: number; title: string } | null>(null);
  // 추가 질문 수정 대상 공모 (게시 후 수정) — 지원자 탭 안에서 연다
  const [editQuestionsEx, setEditQuestionsEx] = useState<{ id: number; title: string } | null>(null);
  const termsRef = useRef<HTMLDivElement>(null);
  const deepLinkDone = useRef(false);

  // 임시저장 훅
  const { pending: draftPending, savedAt: draftSavedAt, resume: resumeDraft, discard: discardDraft, save: saveDraft, clear: clearDraft, autoSave } = useFormDraft<typeof emptyExForm>('draft_exhibition_form');

  // 폼 변경 감지
  const isDirty = showForm && JSON.stringify(form) !== JSON.stringify(emptyExForm);
  useUnsavedChanges(isDirty);

  // 폼 변경 시 자동저장
  useEffect(() => {
    if (showForm && isDirty) autoSave(form);
  }, [form, showForm, isDirty, autoSave]);

  // 날짜 검증
  const dateError = useMemo(() => validateExhibitionDates({
    deadlineStart: form.deadlineStart || undefined,
    deadline: form.deadline,
    exhibitStartDate: form.recruitOnly ? undefined : (form.exhibitStartDate || undefined),
    exhibitDate: form.recruitOnly ? undefined : (form.exhibitDate || undefined),
    // 공모만 진행하면 자료제출 단계가 없다 — 남아 있는 입력값으로 순서 검사를 하면 안 된다
    submissionDeadline: form.recruitOnly ? undefined : (form.submissionDeadline || undefined),
  }), [form.deadlineStart, form.deadline, form.exhibitStartDate, form.exhibitDate, form.submissionDeadline, form.recruitOnly]);

  // 폼 열기 — 작성하던 공고가 있으면 폼 위 안내(DraftNotice)에서 이어 쓸지 고른다(예전 window.confirm)
  const openExForm = () => setShowForm(true);

  // 전용 등록 화면(/exhibitions/new)에서는 폼만 연 채로 시작한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (createOnly) openExForm(); }, [createOnly]);

  // 약관 텍스트 로드
  useEffect(() => {
    if (showForm) {
      fetch('/terms/exhibition-application.txt')
        .then(r => { if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error(); return r.text(); })
        .then(t => { if (!t.trimStart().startsWith('<!')) setExhibitionTerms(t); })
        .catch(() => setExhibitionTerms('약관을 불러올 수 없습니다.'));
    }
  }, [showForm]);

  // 내 갤러리 목록 (승인된 것만 공모 등록 가능)
  const { data: myGalleries = [] } = useQuery<any[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data),
  });
  const approvedGalleries = myGalleries.filter((g: any) => g.status === 'APPROVED');

  // 내 공모 목록 — 조회 실패는 삼키지 않는다(감사 M18). 실패면 아래 빈 화면이 "없습니다" 대신 오류를 말한다.
  const { data: exhibitions = [], isError: exhibitionsError } = useQuery<any[]>({
    queryKey: ['my-exhibitions'],
    queryFn: () => api.get('/exhibitions/my-exhibitions').then(r => r.data),
  });

  const { data: operationOverview = [], isLoading: operationOverviewLoading } = useQuery<GalleryOperationOverview[]>({
    queryKey: ['my-operation-overview'],
    queryFn: () => api.get('/exhibitions/my-operation-overview').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/exhibitions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-operation-overview'] });
      setShowForm(false);
      setForm(emptyExForm);
      setExhibitionAgreed(false);
      setFormErrors(new Set());
      clearDraft();
      toast.success('공모 등록 요청이 제출되었습니다. 관리자 승인 뒤 모집공고에 올라가요.');
      if (createOnly) navigate('/mypage?tab=my-exhibitions');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  // 공모 삭제
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-operation-overview'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      toast.success('공모가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // 공모 삭제 이중확인 ("삭제" 입력)
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  // 직접 지울 수 없는 공모 — 관리자에게 삭제 요청(수락한 작가 · 판매·정산 기록이 있으면, 서버 lib/deletion.ts)
  const [requestTarget, setRequestTarget] = useState<{ id: number; name: string; reason: string } | null>(null);
  const deleteRequestOf = useMyDeleteRequests();
  const askDelete = async (item: any) => {
    try {
      const blocked = await checkDeletable('exhibition', item.id);
      if (blocked) setRequestTarget({ id: item.id, name: item.title, reason: blocked });
      else setDeleteTarget(item);
    } catch (e: any) {
      toast.error(e.response?.data?.error || '삭제할 수 있는지 확인하지 못했어요.');
    }
  };

  const overviewItems = operationOverview.length > 0
    ? operationOverview
    : exhibitions.map(makeFallbackOperationOverview);
  const customFieldsByExId = useMemo(() => new Map(exhibitions.map((ex: any) => [ex.id, ex.customFields ?? null])), [exhibitions]);

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
    다른 화면에서 한 카드를 가리켜 들어오면(`?ex=<id>&panel=applicants|operation`) 그 카드를 펼쳐 보여 준다.
    공모 상세의 [지원자 보기]·운영 화면의 [내 공모]·[지원자 보기] 가 이 주소를 쓴다.
    ⚠️ 딱 한 번만(`deepLinkDone`) — refetch 때마다 걸리면 사용자가 접어도 다시 열린다.
  */
  useEffect(() => {
    const exId = Number(searchParams.get('ex')) || null;
    if (!exId || deepLinkDone.current || overviewItems.length === 0) return;
    const item = overviewItems.find((x) => x.id === exId);
    if (!item) return;
    deepLinkDone.current = true;
    if (isClosedItem(item)) setExhibitionViewMode('closed');
    if (item.status === 'APPROVED') setOpenPanel({ id: exId, tab: searchParams.get('panel') === 'applicants' ? 'applicants' : 'operation' });
    window.setTimeout(() => document.getElementById(`ex-card-${exId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [overviewItems, searchParams]);

  const switchExhibitionView = (mode: ExhibitionViewMode) => {
    if (!setOpenPanel(null)) return;   // 필터를 바꾸면 열려 있던 탭은 닫는다 — 저장 안 된 입력이 있으면 먼저 묻는다
    setExhibitionViewMode(mode);
  };

  const clearError = (key: string) => setFormErrors(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });

  /** [등록 요청] — 비어 있는 칸을 표시하고, 약관 동의가 없으면 약관으로 데려간다 */
  const requestSubmit = () => {
    // 필수 항목 구체적 검증 + 빨간 테두리 하이라이트
    const missing: string[] = [];
    const errorFields = new Set<string>();
    if (!form.galleryId) { missing.push('갤러리'); errorFields.add('galleryId'); }
    if (!form.title) { missing.push('제목'); errorFields.add('title'); }
    if (richTextLength(form.description) === 0) { missing.push('소개'); errorFields.add('description'); }
    if (!form.deadlineStart) { missing.push('공모 시작일'); errorFields.add('deadlineStart'); }
    if (!form.deadline) { missing.push('공모 마감일'); errorFields.add('deadline'); }
    if (!form.recruitOnly && !form.submissionDeadline) { missing.push('출품 자료 제출 마감일'); errorFields.add('submissionDeadline'); }
    if (!form.recruitOnly && !form.exhibitStartDate) { missing.push('전시 시작일'); errorFields.add('exhibitStartDate'); }
    if (!form.recruitOnly && !form.exhibitDate) { missing.push('전시 종료일'); errorFields.add('exhibitDate'); }
    if (capacityError(form.capacity)) { missing.push(`모집 작가 수(1~${CAPACITY_MAX}명)`); errorFields.add('capacity'); }
    const cleanedCustomFields = sanitizeCustomFields(form.customFields);
    const invalidSelect = cleanedCustomFields.find((field) => (field.type === 'select' || field.type === 'multiselect') && (field.options ?? []).length < 2);
    setFormErrors(errorFields);
    if (missing.length > 0) {
      toast.error(
        () => (
          <div className="text-sm">
            <p className="mb-1 font-medium">다음 필수 항목을 입력해주세요:</p>
            {missing.map((m, i) => <p key={i} className="text-accent">• {m}</p>)}
          </div>
        ),
        { duration: 4000 }
      );
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-form-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    if (dateError) {
      toast.error(dateError);
      return;
    }
    if (invalidSelect) {
      toast.error('객관식 질문은 선택지를 2개 이상 입력해주세요.');
      return;
    }
    // 예전엔 약관에 동의하지 않으면 [등록 요청]이 이유 없이 회색이었다 — 누르면 약관으로 데려간다
    if (!exhibitionAgreed) {
      setTermsError(true);
      termsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast.error('약관에 동의해 주세요.');
      return;
    }
    setForm({ ...form, customFields: cleanedCustomFields });
    setConfirmAction('submit');
  };

  const summary = scheduleSummary(form);
  const flowSteps = form.recruitOnly
    ? ['등록 요청', '관리자 승인', '지원 모집', '작가 선정']
    : ['등록 요청', '관리자 승인', '지원 모집', '작가 선정', '출품 자료', '전시', '정산'];

  return (
    <div>
      {showForm && (
        <div className="space-y-8">
          {/* 작성하던 공고 — 고를 때까지 아무것도 덮어쓰지 않는다(lib/formDraft.ts) */}
          {draftPending && (
            <DraftNotice
              title="작성하던 공고가 있어요"
              summary={draftPending.data.title}
              savedAt={draftPending.savedAt}
              onResume={() => { const d = resumeDraft(); if (d) setForm({ ...emptyExForm, ...d }); }}
              onDiscard={discardDraft}
            />
          )}
          {/* 전체 순서 — 처음 등록하는 갤러리가 끝까지 무엇이 있는지 여기서 본다 */}
          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500">공모는 이렇게 진행돼요</p>
            <ProgressSteps variant="inline" steps={flowSteps} current={0} label="공모 진행 순서" className="mt-1.5" />
          </div>

          {approvedGalleries.length === 0 ? (
            <Notice
              tone="attention"
              title="승인된 갤러리가 없어요"
              action={<button type="button" onClick={() => navigate('/galleries/new')} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50">갤러리 등록하기</button>}
            >
              공모는 승인된 갤러리 이름으로 올라가요. 먼저 갤러리를 등록하고 승인을 받아 주세요.
            </Notice>
          ) : (
            <>
              <FormSection n={1} title="진행 범위" description="어디까지 이 페이지에서 진행할지 골라 주세요. 등록한 뒤에는 바꿀 수 없어요.">
                {/* 어디까지 진행할지 — 이걸 정해야 아래 '자료 제출 마감일' 칸이 필요한지가 갈린다 */}
                <ExhibitionScopePicker
                  bare
                  recruitOnly={form.recruitOnly}
                  onChange={(next) => {
                    setForm({ ...form, recruitOnly: next, ...(next ? { submissionDeadline: '', exhibitStartDate: '', exhibitDate: '' } : {}) });
                    ['submissionDeadline', 'exhibitStartDate', 'exhibitDate'].forEach(clearError);
                  }}
                />
              </FormSection>

              <FormSection n={2} title="공고 내용" description="모집공고 목록과 상세 페이지에 그대로 보여요.">
                <div className="grid gap-5 sm:grid-cols-[168px_minmax(0,1fr)]">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-gray-800">포스터</p>
                    <HeroImageEdit value={form.imageUrl} onChange={(url) => setForm({ ...form, imageUrl: url })} onRemove={() => setForm({ ...form, imageUrl: '' })} className="aspect-[210/297] w-full max-w-[168px] rounded-lg" label="포스터" />
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-500">세로형(A4 비율)을 권해요. 목록 카드에 이 비율로 보여요.</p>
                  </div>
                  <div className="min-w-0 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <FormField label="갤러리 *" error={formErrors.has('galleryId')} htmlFor="ex-gallery">
                        <select id="ex-gallery" data-form-error={formErrors.has('galleryId') || undefined} value={form.galleryId} onChange={e => { setForm({ ...form, galleryId: Number(e.target.value) }); clearError('galleryId'); }} className={formInputCls(formErrors.has('galleryId'))}>
                          <option value={0}>갤러리 선택</option>
                          {approvedGalleries.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </FormField>
                      <FormField label="구분" htmlFor="ex-type">
                        <select id="ex-type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={formInputCls()}>
                          <option value="SOLO">개인전</option>
                          <option value="GROUP">단체전</option>
                          <option value="ART_FAIR">아트페어</option>
                        </select>
                      </FormField>
                      <FormField label="지역" htmlFor="ex-region">
                        <select id="ex-region" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className={formInputCls()}>
                          {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
                        </select>
                      </FormField>
                    </div>
                    <FormField label="공모 제목 *" error={formErrors.has('title')} htmlFor="ex-title">
                      <input id="ex-title" data-form-error={formErrors.has('title') || undefined} value={form.title} onChange={e => { setForm({ ...form, title: e.target.value }); clearError('title'); }} placeholder="공모 제목" className={formInputCls(formErrors.has('title'))} />
                    </FormField>
                    {/* 정원 = 선정 인원(2026-09-27). 지원은 무제한이라 갤러리가 '5명만 지원받는다'로 오해하지 않게 적어 둔다 */}
                    <FormField label="모집 작가 수 *" error={formErrors.has('capacity')} htmlFor="ex-capacity" hint="지원은 제한 없이 받고, 이 인원까지 수락할 수 있어요. 승인 뒤에도 [지원자]에서 바꿀 수 있어요.">
                      <input
                        id="ex-capacity"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={CAPACITY_MAX}
                        data-form-error={formErrors.has('capacity') || undefined}
                        value={form.capacity || ''}
                        onChange={e => { setForm({ ...form, capacity: Number(e.target.value) }); clearError('capacity'); }}
                        className={cn(formInputCls(formErrors.has('capacity')), 'max-w-[140px]')}
                      />
                    </FormField>
                  </div>
                </div>
                {/* 서식 있는 글(2026-10-03, 갤러리 소개와 같은 편집기) — 제목·굵게·목록·링크. 서버가 허용 목록으로 걸러 저장한다.
                    ⚠️ 값은 함수형으로 갱신할 것 — 편집기가 처음 받은 콜백을 붙들 수 있어, `{ ...form }` 이면 그사이 고친 다른 칸을 되돌린다 */}
                <FormField label="공모 소개 *" error={formErrors.has('description')} className="mt-5" hint="제목·굵게·목록·링크 같은 서식을 쓸 수 있어요.">
                  <div id="ex-desc" data-form-error={formErrors.has('description') || undefined} className={cn('rounded-lg', formErrors.has('description') && 'ring-1 ring-accent')}>
                    <LazyRichTextEditor
                      value={form.description}
                      onChange={(v) => { setForm(prev => ({ ...prev, description: v })); clearError('description'); }}
                      placeholder="공모 소개"
                      maxLength={20000}
                      minHeight={200}
                    />
                  </div>
                </FormField>
              </FormSection>

              <FormSection n={3} title="일정">
                {/* 칸 순서가 곧 시간 순서다 — 예전엔 공모 → 전시 → 자료 제출 순이라 위부터 채우면 순서 오류가 났다.
                    min/max 로 달력 자체를 막아, 틀린 날짜를 고르고 저장에서 튕기는 일이 없게 한다. */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="공모 시작일 *" error={formErrors.has('deadlineStart')} htmlFor="ex-start" hint="이날부터 지원을 받아요.">
                    <input id="ex-start" type="date" data-form-error={formErrors.has('deadlineStart') || undefined} value={form.deadlineStart} onChange={e => { setForm({ ...form, deadlineStart: e.target.value }); clearError('deadlineStart'); }} max={form.deadline || undefined} className={formInputCls(formErrors.has('deadlineStart'))} />
                  </FormField>
                  <FormField label="공모 마감일 *" error={formErrors.has('deadline')} htmlFor="ex-deadline" hint="이날이 지나면 지원이 닫혀요.">
                    <input id="ex-deadline" type="date" data-form-error={formErrors.has('deadline') || undefined} value={form.deadline} onChange={e => { setForm({ ...form, deadline: e.target.value }); clearError('deadline'); }} min={form.deadlineStart || undefined} max={form.submissionDeadline || form.exhibitStartDate || form.exhibitDate || undefined} className={formInputCls(formErrors.has('deadline'))} />
                  </FormField>
                  {/* ⚠️ 공모만 진행하면 자료 제출·전시가 없다 — 비활성이 아니라 칸 자체를 없앤다(2026-09-19 사용자 지적). 서버도 요구하지 않는다. */}
                  {!form.recruitOnly && (
                    <>
                      <FormField className="sm:col-span-2" label="출품 자료 제출 마감일 *" error={formErrors.has('submissionDeadline')} htmlFor="ex-submission" hint="수락한 작가가 출품작·약력·작가노트를 내는 기한이에요. 공모 마감일과 전시 시작일 사이로 정해 주세요.">
                        <input id="ex-submission" type="date" data-form-error={formErrors.has('submissionDeadline') || undefined} value={form.submissionDeadline} onChange={e => { setForm({ ...form, submissionDeadline: e.target.value }); clearError('submissionDeadline'); }} min={form.deadline || undefined} max={form.exhibitStartDate || form.exhibitDate || undefined} className={cn(formInputCls(formErrors.has('submissionDeadline')), 'sm:max-w-[calc(50%-0.5rem)]')} />
                      </FormField>
                      <FormField label="전시 시작일 *" error={formErrors.has('exhibitStartDate')} htmlFor="ex-show-start" hint="이날이 되면 전시가 자동으로 확정되고, 작가는 출품 자료를 더 고칠 수 없어요.">
                        <input id="ex-show-start" type="date" data-form-error={formErrors.has('exhibitStartDate') || undefined} value={form.exhibitStartDate} onChange={e => { setForm({ ...form, exhibitStartDate: e.target.value }); clearError('exhibitStartDate'); }} min={form.submissionDeadline || form.deadline || undefined} max={form.exhibitDate || undefined} className={formInputCls(formErrors.has('exhibitStartDate'))} />
                      </FormField>
                      <FormField label="전시 종료일 *" error={formErrors.has('exhibitDate')} htmlFor="ex-show-end" hint="전시가 끝나면 판매 내역을 입력해 정산해요.">
                        <input id="ex-show-end" type="date" data-form-error={formErrors.has('exhibitDate') || undefined} value={form.exhibitDate} onChange={e => { setForm({ ...form, exhibitDate: e.target.value }); clearError('exhibitDate'); }} min={form.exhibitStartDate || form.deadline || undefined} className={formInputCls(formErrors.has('exhibitDate'))} />
                      </FormField>
                    </>
                  )}
                </div>
                {summary && <p className="mt-5 text-sm text-gray-700"><span className="text-gray-400">한눈에 · </span>{summary}</p>}
                {dateError && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-accent"><AlertTriangle size={12} aria-hidden /> {dateError}</p>
                )}
              </FormSection>

              <FormSection n={4} title="추가 질문 (선택)" description="지원서에 더 물어볼 게 있으면 넣으세요. 설치 가능 일정, 작품 운송 방식 같은 것들이에요.">
                <CustomQuestionBuilder
                  bare
                  fields={form.customFields}
                  onChange={(updateCustomFields) => setForm((prev) => ({ ...prev, customFields: updateCustomFields(prev.customFields) }))}
                />
              </FormSection>

              <FormSection n={5} title="약관">
                <div ref={termsRef} className={cn('overflow-hidden rounded-xl border', termsError && !exhibitionAgreed ? 'border-accent' : 'border-gray-200')}>
                  <div className="max-h-40 overflow-y-auto whitespace-pre-wrap bg-white p-3 text-xs leading-relaxed text-gray-600">{exhibitionTerms || '약관 로딩 중...'}</div>
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-2 border-t border-gray-200 bg-gray-50 px-3 text-sm">
                    <input type="checkbox" checked={exhibitionAgreed} onChange={e => { setExhibitionAgreed(e.target.checked); setTermsError(false); }} className="h-4 w-4 rounded" />
                    위 약관에 동의합니다
                  </label>
                </div>
                {termsError && !exhibitionAgreed && <p className="mt-1.5 text-xs text-accent">약관에 동의해야 등록을 요청할 수 있어요.</p>}
              </FormSection>

              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-6">
                <button
                  type="button"
                  disabled={createMutation.isPending}
                  onClick={requestSubmit}
                  className="min-h-[44px] rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >{createMutation.isPending ? '등록 중...' : '등록 요청'}</button>
                <button type="button" onClick={() => {
                  if (saveDraft(form)) toast.success('임시저장했어요. 이 브라우저에 남아 있어요.');
                  else {
                    toast.error(draftPending ? '작성하던 공고를 먼저 [이어서 쓰기] 또는 [새로 쓰기]로 정해 주세요.' : '임시저장하지 못했어요.');
                    if (draftPending) window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-50">
                  <Save size={14} aria-hidden /> 임시저장
                </button>
                <button type="button" onClick={() => { if (isDirty) { setConfirmAction('cancel'); } else if (createOnly) { navigate(-1); } else { setShowForm(false); setExhibitionAgreed(false); setFormErrors(new Set()); } }} className="min-h-[44px] px-3 text-sm text-gray-500 hover:text-gray-900">취소</button>
                {draftSavedAt && <span className="text-xs text-gray-400">{savedAtLabel(draftSavedAt)} 저장됨</span>}
                <p className="w-full text-xs text-gray-500">등록을 요청하면 관리자가 확인한 뒤 모집공고에 올려요. 승인되면 알림으로 알려 드려요. 쓰던 내용은 이 브라우저에 자동으로 저장돼요.</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* 추가 질문 수정 모달 (게시 후) */}
      {editQuestionsEx && (
        <CustomQuestionsEditModal
          exhibitionId={editQuestionsEx.id}
          exhibitionTitle={editQuestionsEx.title}
          initialFields={customFieldsByExId.get(editQuestionsEx.id) as CustomField[] | null | undefined}
          onClose={() => setEditQuestionsEx(null)}
        />
      )}

      {/* 작가 초대 모달 — 관심 작품(하트)을 저장한 작가를 이 공모에 초대 */}
      {inviteEx && (
        <ExhibitionInviteModal
          exhibitionId={inviteEx.id}
          exhibitionTitle={inviteEx.title}
          onClose={() => setInviteEx(null)}
        />
      )}


      {/* 등록/취소 확인 모달 */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        title="공모 등록을 요청할까요?"
        details={[
          '관리자가 내용을 확인한 뒤 모집공고에 올려요. 승인되면 알림으로 알려 드려요.',
          ...(summary ? [`일정 · ${summary}`] : []),
          '승인 뒤에는 공고 소개·포스터·추가 질문·모집 인원을 고칠 수 있어요. 날짜를 바꿔야 하면 1:1 문의로 알려 주세요.',
        ]}
        confirmText="등록 요청"
        onConfirm={() => { setConfirmAction(null); createMutation.mutate({ ...form, customFields: sanitizeCustomFields(form.customFields) }); }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="작성 취소"
        message={'작성 중인 내용이 있습니다. 정말 취소하시겠습니까?\n임시저장된 내용은 유지됩니다.'}
        confirmText="취소하기"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); setShowForm(false); setExhibitionAgreed(false); setFormErrors(new Set()); if (createOnly) navigate(-1); }}
        onCancel={() => setConfirmAction(null)}
      />

      {!showForm && (
        <div className="space-y-5">
          {/* 머리 — 이 탭이 무엇을 하는 곳인지 한 줄 */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold text-gray-950">내 공모</h2>
              <p className="mt-1 text-sm text-gray-500">공고를 올리고, 지원자를 뽑고, 전시와 정산까지 여기서 이어서 진행해요.</p>
            </div>
            <button onClick={() => navigate('/exhibitions/new')} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-accent/40 px-4 text-sm font-medium text-accent transition-colors hover:bg-accent/5">
              <Plus size={14} aria-hidden /> 공모 등록
            </button>
          </div>

          <PageTabBar<ExhibitionViewMode>
            sticky={false}
            idPrefix="my-exhibitions"
            label="공모 목록"
            active={exhibitionViewMode}
            onSelect={switchExhibitionView}
            tabs={[
              { id: 'active', label: '진행 중', count: activeExhibitions.length },
              { id: 'closed', label: '종료', count: closedExhibitions.length },
            ]}
          />

          {operationOverviewLoading ? (
            <div className="grid gap-4">
              {[0, 1].map(i => <div key={i} className="h-56 animate-pulse rounded-2xl bg-gray-100" />)}
            </div>
          ) : shownExhibitions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-14 text-center">
              {exhibitionViewMode === 'closed' ? (
                <p className="text-sm text-gray-500">아직 정산까지 끝난 공모가 없어요.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-500">{exhibitionsError ? '공모 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : closedExhibitions.length > 0 ? '진행 중인 공모가 없어요.' : '아직 올린 공모가 없어요.'}</p>
                  {!exhibitionsError && closedExhibitions.length === 0 && (
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-400">공모를 등록하면 관리자 승인 뒤 모집공고에 올라가고, 지원자 선정·출품 자료·전시·정산까지 이 탭에서 이어서 진행해요.</p>
                  )}
                  <button onClick={() => navigate('/exhibitions/new')} className="mt-5 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-accent/40 px-4 text-sm font-medium text-accent hover:bg-accent/5">
                    <Plus size={14} aria-hidden /> 공모 등록
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {shownExhibitions.map((item) => {
                const apps = item.counts.applications;
                const submissions = item.counts.submissions;
                const settlement = item.counts.settlement;
                const pending = apps.submitted + apps.reviewed;
                const incomplete = Math.max(0, submissions.required - submissions.complete);
                const isApproved = item.status === 'APPROVED';
                const archived = !!item.settledAt || isClosedItem(item);
                const stage = stageOf({ ...item, settlementStarted: item.counts.sales.total > 0 || !!item.settlementRequestedAt })!;
                const deadlineLabel = isApproved && !item.recruitmentClosed ? ddayText('마감', item.deadline) : null;
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
                  submissionsIncomplete: incomplete,
                  sales: item.counts.sales.total,
                  approvals: { total: settlement.total, approved: settlement.approved, issue: settlement.issue },
                });
                const panel = openPanel?.id === item.id ? openPanel.tab : null;
                const openTab = (tab: 'applicants' | 'operation') => setOpenPanel({ id: item.id, tab });
                const goTask = () => {
                  if (!task.target) return;
                  if (task.target === 'applicants') { openTab('applicants'); return; }
                  openTab('operation');
                  setOpsFocus({ target: task.target, seq: Date.now() });
                };
                // 작가 초대는 **모집 중에만** — 서버도 recruitmentClosed·confirmed·ended 를 막는다(눌러서 400 을 받는 버튼 금지)
                const canInvite = isApproved && !item.recruitmentClosed && !item.confirmed && !item.ended;
                // 정산이 끝난 공모는 기록을 남긴다 — 직접 삭제도 삭제 요청도 없다. 그 밖엔 버튼을 누르면 서버가 직접 삭제 / 요청 중 하나를 고른다
                const deleteRequest = deleteRequestOf('exhibition', item.id);
                const deletable = item.hostType !== 'ADMIN' && !item.settledAt && deleteRequest?.status !== 'PENDING';
                return (
                  // ⚠️ min-w-0 필수(규칙 27) — 이 카드는 grid 아이템이라, 없으면 안쪽 통계 칸(1fr 두 칸)이 글자 폭만큼 카드를 밀어
                  //    390px 화면에서 페이지가 가로로 408~472px 까지 밀렸다(2026-09-29 실측).
                  <article key={item.id} id={`ex-card-${item.id}`} className="min-w-0 scroll-mt-24 rounded-2xl border border-gray-200 bg-white">
                    <div className="p-5 md:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip variant={stage.variant}>{stage.label}</StatusChip>
                            {deadlineLabel && <span className="text-xs font-medium tabular-nums text-gray-500">{deadlineLabel}</span>}
                            {settlement.issue > 0 && !item.settledAt && <StatusChip variant="attention">정산 이의 {settlement.issue}</StatusChip>}
                            {/* 아트링크가 주최하고 우리 갤러리는 운영만 맡은 공모 — 카드의 갤러리명이 주관 갤러리라 구분이 필요하다 */}
                            <HostBadge exhibition={item} />
                          </div>
                          {/* 누르는 곳 44px(점검 P3 — 28px 였다). 저장 안 된 정산·출품 자료 입력이 있으면 먼저 묻는다 */}
                          <button
                            type="button"
                            onClick={() => { if (confirmDiscardUnsaved()) navigate(`/exhibitions/${item.id}`); }}
                            className="mt-1.5 flex min-h-[44px] max-w-full items-center text-left text-xl font-semibold text-gray-950 hover:underline"
                          >
                            <span className="truncate">{item.title}</span>
                          </button>
                          <p className="mt-1 text-sm text-gray-500">
                            {item.gallery?.name || '아트링크'} · {exhibitionTypeLabels[item.type] || item.type} · {regionLabels[item.region] || item.region}
                          </p>
                        </div>
                        {/* 삭제는 카드 **우측 상단 모서리**에 따로 둔다 — 다른 버튼 옆에 있으면 잘못 눌러 공모가 지워질 수 있다.
                            아트링크 주최 공모(위임 운영)·정산 완료 건은 지울 수 없다(서버도 403/400). */}
                        {deletable && !archived && (
                          <button
                            type="button"
                            onClick={() => askDelete(item)}
                            className="-mr-2 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-gray-300 hover:bg-accent/5 hover:text-accent"
                            title="공모 삭제"
                            aria-label="공모 삭제"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>

                      {/* 지금 할 일 — 처음 쓰는 갤러리가 "그래서 뭘 누르지?" 에서 막히던 자리 */}
                      <TaskLine task={task} onClick={isApproved && task.target ? goTask : undefined} />
                      <DeleteRequestLine request={deleteRequest} kind="exhibition" />

                      {item.status === 'REJECTED' && item.rejectReason && (
                        <Notice tone="attention" title="반려 사유" className="mt-3">{item.rejectReason}</Notice>
                      )}

                      {/* 공모만 진행하면 출품 자료·판매/정산 단계가 없다 — 칸을 그리지 않는다(2026-09-27) */}
                      <dl className={cn('mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-gray-100 pt-4', !item.recruitOnly && 'md:grid-cols-4')}>
                        <div className="min-w-0">
                          <dt className="text-xs text-gray-500">지원자</dt>
                          <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{apps.total}명</dd>
                          {/* 정원 = 선정 인원 — 수락이 몇 자리 남았는지 여기서 보인다 */}
                          <dd className="text-xs tabular-nums text-gray-500">수락 {apps.accepted}{item.capacity ? `/${item.capacity}` : ''} · 검토 대기 {pending}</dd>
                        </div>
                        {!item.recruitOnly && (
                          <div className="min-w-0">
                            <dt className="text-xs text-gray-500">출품 자료</dt>
                            <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{submissions.required > 0 ? `${submissions.complete}/${submissions.required}` : '—'}</dd>
                            <dd className="text-xs text-gray-500">{submissions.required === 0 ? '수락한 작가가 생기면 모여요' : incomplete > 0 ? `${incomplete}명 미제출` : '모두 제출'}</dd>
                          </div>
                        )}
                        {!item.recruitOnly && (
                          <div className="min-w-0">
                            <dt className="text-xs text-gray-500">판매·정산</dt>
                            <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{item.ended ? `${item.counts.sales.total}건` : '—'}</dd>
                            <dd className="text-xs tabular-nums text-gray-500">
                              {!item.ended ? '전시가 끝나면 열려요' : item.settledAt ? '정산 완료' : item.settlementRequestedAt ? `작가 확인 ${settlement.approved}/${settlement.total}` : '정산 전'}
                            </dd>
                          </div>
                        )}
                        <div className="min-w-0">
                          <dt className="text-xs text-gray-500">일정</dt>
                          <dd className="mt-1 text-sm font-medium text-gray-950">공모 {operationRange(item.deadlineStart, item.deadline)}</dd>
                          {!item.recruitOnly && <dd className="text-xs text-gray-500">전시 {operationRange(item.exhibitStartDate, item.exhibitDate)}</dd>}
                        </div>
                      </dl>
                    </div>

                    {/* 카드 안 탭 — [지원자] / [운영]. 한 번에 하나만 펼친다(예전 두 버튼은 이유 없이 서로를 닫았다) */}
                    {isApproved && (
                      <>
                        <div className="flex items-center gap-6 border-t border-gray-100 px-5 md:px-6">
                          {(['applicants', 'operation'] as const).map(tab => {
                            const on = panel === tab;
                            return (
                              <button
                                key={tab}
                                type="button"
                                aria-expanded={on}
                                aria-controls={`ex-${item.id}-${tab}`}
                                onClick={() => setOpenPanel(on ? null : { id: item.id, tab })}
                                className={cn('relative min-h-[48px] min-w-[44px] whitespace-nowrap text-sm', on ? 'font-semibold text-gray-950' : 'text-gray-500 hover:text-gray-900')}
                              >
                                {tab === 'applicants'
                                  ? <>지원자 <span className="ml-0.5 text-xs font-normal tabular-nums text-gray-400">{apps.total}</span></>
                                  : '운영'}
                                {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-gray-900" />}
                              </button>
                            );
                          })}
                          {panel && (
                            <button type="button" onClick={() => setOpenPanel(null)} className="ml-auto inline-flex min-h-[40px] items-center gap-1 text-xs text-gray-500 hover:text-gray-900">
                              접기 <ChevronUp size={14} aria-hidden />
                            </button>
                          )}
                        </div>

                        {/* 한 번 연 탭은 숨기기만 한다(위 visitedTabs) — 입력 중이던 정산·출품 자료가 탭을 오가도 남게 */}
                        {openPanel?.id === item.id && visitedTabs.includes('applicants') && (
                          <div id={`ex-${item.id}-applicants`} hidden={panel !== 'applicants'} className="border-t border-gray-100 p-5 md:p-6">
                            <ApplicantManager
                              exhibitionId={item.id}
                              exhibitionTitle={item.title}
                              customFields={customFieldsByExId.get(item.id) as CustomField[] | null | undefined}
                              capacity={item.capacity ?? null}
                              recruitOnly={!!item.recruitOnly}
                              ended={!!item.ended || !!item.settledAt}
                              // 아트링크 주최 공모의 모집 인원은 아트링크(관리자)가 정한다 — 위임 갤러리는 못 고친다(서버 403)
                              capacityEditable={item.hostType !== 'ADMIN'}
                              toolbar={(
                                <>
                                  {/* 관심 작품(하트)을 저장한 작가를 이 공모에 직접 초대 — 모집 중에만 */}
                                  {canInvite && (
                                    <button type="button" onClick={() => setInviteEx({ id: item.id, title: item.title })} className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-950">
                                      <Mail size={13} aria-hidden /> 작가 초대
                                    </button>
                                  )}
                                  {/* 게시 후 추가 질문 수정 — 정산 완료 전까지 */}
                                  {!item.settledAt && (
                                    <button type="button" onClick={() => setEditQuestionsEx({ id: item.id, title: item.title })} className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-950">
                                      <Edit3 size={13} aria-hidden /> 추가 질문 수정
                                    </button>
                                  )}
                                </>
                              )}
                            />
                          </div>
                        )}

                        {/* 운영 — 페이지 이동 없이 카드 안에서(진행 단계 · 공지 · 출품 자료 · 정산). 운영 화면 코드를 그대로 임베드 */}
                        {openPanel?.id === item.id && visitedTabs.includes('operation') && (
                          <div id={`ex-${item.id}-operation`} hidden={panel !== 'operation'} className="border-t border-gray-100 p-5 md:p-6">
                            <OperationBody id={String(item.id)} embedded focus={opsFocus} />
                          </div>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}


      <DeleteConfirmModal
        open={!!deleteTarget}
        name={deleteTarget?.title ?? ''}
        description="공모를 삭제하면 지원 내역도 함께 삭제되며 되돌릴 수 없습니다. 지원한 작가에게 삭제 알림이 가요."
        pending={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <DeleteRequestDialog
        open={!!requestTarget}
        kind="exhibition"
        targetId={requestTarget?.id ?? 0}
        name={requestTarget?.name ?? ''}
        blockedReason={requestTarget?.reason ?? ''}
        onClose={() => setRequestTarget(null)}
      />
    </div>
  );
}

// ========== Gallery: 내 전시(Show) 관리 ==========
const emptyShowForm = {
  title: '', description: '', startDate: '', endDate: '',
  openingHours: '', admissionFee: '', location: '', region: 'SEOUL',
  posterImage: '', galleryId: 0,
  additionalImages: [] as { url: string }[],
};
function MyShowsSection({ createOnly = false }: { createOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showForm, setShowForm] = useState(false);
  // 전용 등록 화면(/shows/new)에서는 폼만 연 채로 시작한다.
  useEffect(() => { if (createOnly) setShowForm(true); }, [createOnly]);

  // 내 갤러리 (전시 등록 시 선택용) — owned=true로 본인 갤러리 전체 조회 (/galleries/my 라우트는 없음)
  const { data: myGalleries = [] } = useQuery<Gallery[]>({
    queryKey: ['my-galleries'],
    queryFn: () => api.get('/galleries?owned=true').then(r => r.data),
  });
  const approvedGalleries = myGalleries.filter(g => g.status === 'APPROVED');

  // 내 전시 목록
  const { data: myShows = [], isLoading } = useQuery<Show[]>({
    queryKey: ['my-shows'],
    queryFn: () => api.get('/shows/my-shows').then(r => r.data),
  });

  // 전시 등록 폼 상태
  const [form, setForm] = useState({ ...emptyShowForm });

  // 작가 목록 (동적)
  const [artists, setArtists] = useState<ArtistEntry[]>([{ name: '' }]);
  const [searchResults, setSearchResults] = useState<{ id: number; name: string; nickname?: string | null; avatar?: string }[]>([]);
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);

  // 이탈 경고·임시저장 — 갤러리·공모 폼엔 있었는데 전시 폼만 없어 포스터·작가 목록까지 채운 뒤 링크 한 번이면 사라졌다(감사 M19)
  const { pending: draftPending, savedAt: draftSavedAt, resume: resumeDraft, discard: discardDraft, clear: clearDraft, autoSave } = useFormDraft<{ form: typeof emptyShowForm; artists: ArtistEntry[] }>('draft_show_form');
  const isDirty = showForm && (JSON.stringify(form) !== JSON.stringify(emptyShowForm) || artists.some(a => a.name.trim() || a.userId));
  useUnsavedChanges(isDirty);
  useEffect(() => { if (showForm && isDirty) autoSave({ form, artists }); }, [form, artists, showForm, isDirty, autoSave]);
  // 작성하던 전시가 있으면 폼 위 안내(DraftNotice)에서 이어 쓸지 고른다(예전 window.confirm)
  const resumeShowDraft = () => {
    const d = resumeDraft();
    if (!d) return;
    setForm({ ...emptyShowForm, ...d.form });
    if (Array.isArray(d.artists) && d.artists.length) setArtists(d.artists);
  };

  // 검색 드롭다운 — 바깥 클릭·ESC 로 닫는다. 예전엔 작가를 고를 때만 닫혀 검색만 하고 안 고르면 아래 작가 행을 덮었다(감사 M20)
  useEffect(() => {
    if (searchingIdx === null) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('[data-artist-search]')) setSearchingIdx(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchingIdx(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [searchingIdx]);

  // 약관 동의
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState('');

  // 약관 텍스트 로드
  useEffect(() => {
    if (showForm) {
      fetch('/terms/show-registration.txt')
        .then(r => { if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error(); return r.text(); })
        .then(t => { if (!t.trimStart().startsWith('<!')) setShowTerms(t); })
        .catch(() => setShowTerms('약관을 불러올 수 없습니다.'));
    }
  }, [showForm]);

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/shows', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-shows'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      setShowForm(false);
      setForm({ ...emptyShowForm });
      setArtists([{ name: '' }]);
      setAgreedTerms(false);
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

  // 작가 검색
  const searchArtist = async (idx: number) => {
    const name = artists[idx]?.name?.trim();
    if (!name) { toast.error('작가 이름을 입력해주세요.'); return; }
    try {
      const res = await api.get(`/portfolio/search?q=${encodeURIComponent(name)}`);
      setSearchResults(res.data);
      setSearchingIdx(idx);
    } catch { toast.error('검색에 실패했습니다.'); }
  };

  // 작가 선택 (연동)
  const linkArtist = (idx: number, user: { id: number; name: string }) => {
    const updated = [...artists];
    updated[idx] = { name: user.name, userId: user.id };
    setArtists(updated);
    setSearchingIdx(null);
    setSearchResults([]);
  };

  const handleSubmit = () => {
    if (!form.title || richTextLength(form.description) === 0 || !form.startDate || !form.endDate || !form.openingHours || !form.admissionFee || !form.location || !form.posterImage || !form.galleryId) {
      toast.error('모든 필수 항목을 입력해주세요.');
      return;
    }
    if (new Date(form.startDate) > new Date(form.endDate)) {
      toast.error('시작일은 종료일 이전이어야 합니다.');
      return;
    }
    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(form.openingHours)) {
      toast.error('관람 시작·종료 시간을 모두 선택해주세요.');
      return;
    }
    const validArtists = artists.filter(a => a.name.trim());
    createMutation.mutate({
      ...form,
      artists: validArtists.length > 0 ? validArtists : null,
      additionalImages: form.additionalImages.map(img => img.url),
    });
  };

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

      {/* 등록 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          {draftPending && (
            <DraftNotice
              title="작성하던 전시가 있어요"
              summary={draftPending.data.form?.title}
              savedAt={draftPending.savedAt}
              onResume={resumeShowDraft}
              onDiscard={discardDraft}
              className="bg-white"
            />
          )}
          <p className="text-xs text-gray-400">실제 전시 상세 페이지에 보일 모습입니다. 칸을 눌러 바로 입력하세요.</p>
          <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
            <HeroImageEdit value={form.posterImage} onChange={(url) => setForm({ ...form, posterImage: url })} onRemove={() => setForm({ ...form, posterImage: '' })} className="w-full aspect-[4/3]" label="포스터 이미지" />
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={form.galleryId} onChange={e => {
                  const gid = Number(e.target.value);
                  const g = approvedGalleries.find(x => x.id === gid);
                  setForm(prev => {
                    const prevG = approvedGalleries.find(x => x.id === prev.galleryId);
                    // 위치를 사용자가 직접 입력하지 않았으면(비었거나 이전 갤러리 주소와 동일) 갤러리 주소 자동 입력
                    const locUntouched = !prev.location || (!!prevG && prev.location === prevG.address);
                    return {
                      ...prev,
                      galleryId: gid,
                      location: g && locUntouched ? g.address : prev.location,
                      region: g ? g.region : prev.region,
                    };
                  });
                }} className="text-xs px-2.5 py-1 bg-gray-900 text-white rounded-full cursor-pointer focus:outline-none">
                  <option value={0}>갤러리 선택</option>
                  {approvedGalleries.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="text-xs px-2.5 py-1 bg-gray-100 rounded-full text-gray-600 cursor-pointer focus:outline-none">
                  {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
                </select>
              </div>
              <EditableText value={form.title} onChange={v => setForm({ ...form, title: v })} placeholder="전시 제목" className="text-2xl font-serif text-gray-900" />
              {/* 메타: 일정/시간/입장료/위치 */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="text-xs text-gray-500">시작일</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="w-full mt-0.5 p-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">종료일</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className="w-full mt-0.5 p-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500">관람 시간</label>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input type="time" aria-label="관람 시작 시간" value={form.openingHours.split('-')[0] || ''}
                      onChange={e => { const close = form.openingHours.split('-')[1] || ''; setForm({ ...form, openingHours: e.target.value || close ? `${e.target.value}-${close}` : '' }); }}
                      className="flex-1 p-2 border border-gray-200 rounded-lg text-sm" />
                    <span className="text-gray-400">~</span>
                    <input type="time" aria-label="관람 종료 시간" value={form.openingHours.split('-')[1] || ''}
                      onChange={e => { const open = form.openingHours.split('-')[0] || ''; setForm({ ...form, openingHours: open || e.target.value ? `${open}-${e.target.value}` : '' }); }}
                      className="flex-1 p-2 border border-gray-200 rounded-lg text-sm" />
                  </div>
                </div>
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                <div className="flex items-center gap-2"><Ticket size={15} className="text-gray-400 shrink-0" /><EditableText value={form.admissionFee} onChange={v => setForm({ ...form, admissionFee: v })} placeholder="입장료 (예: 무료, 5,000원)" className="text-sm flex-1" /></div>
                <div className="flex items-center gap-2"><MapPin size={15} className="text-gray-400 shrink-0" /><EditableText value={form.location} onChange={v => setForm({ ...form, location: v })} placeholder="위치 (갤러리 선택 시 자동 입력, 외부 장소면 직접 수정)" className="text-sm flex-1" /></div>
              </div>
              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-400 mb-1">전시 소개</p>
                {/* 서식 있는 글(2026-10-03, 공모 소개와 같은 편집기). 함수형 갱신 — 위 공모 폼의 ⚠️ 와 같은 이유 */}
                <LazyRichTextEditor value={form.description} onChange={(v) => setForm(prev => ({ ...prev, description: v }))} placeholder="전시 소개" maxLength={20000} minHeight={160} />
              </div>
            </div>
          </div>
          {/* 참여 작가 (동적 목록) */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">참여 작가</label>
            {artists.map((artist, idx) => (
              <div key={idx} data-artist-search className="relative">
                <div className="flex gap-2">
                  <input
                    placeholder="작가 이름"
                    value={artist.name}
                    onChange={e => {
                      const updated = [...artists];
                      updated[idx] = { name: e.target.value };
                      setArtists(updated);
                    }}
                    className={`min-w-0 flex-1 p-2 border rounded-lg text-sm ${artist.userId ? 'border-gray-400 bg-gray-50' : 'border-gray-200'}`}
                  />
                  {artist.userId ? (
                    <span className="flex items-center gap-1 text-xs text-gray-600">
                      <Check size={12} className="text-green-600" /> 연동됨
                      {/* 예전엔 '연동됨' 배지 자체가 누르면 풀리는 버튼이었다 — 완료 표시로 읽혀 무슨 일이 나는지 알 수 없었다(감사 M20) */}
                      <button type="button" onClick={() => { const updated = [...artists]; updated[idx] = { name: artist.name }; setArtists(updated); toast('작가 연동을 해제했습니다.'); }}
                        className="ml-1 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-gray-400 hover:text-gray-900">
                        연동 해제
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => searchArtist(idx)}
                      className="px-2 text-xs text-gray-500 border border-gray-200 rounded-lg flex items-center gap-1 hover:border-gray-400">
                      <Search size={12} /> 검색
                    </button>
                  )}
                  {artists.length > 1 && (
                    <button type="button" onClick={() => setArtists(artists.filter((_, i) => i !== idx))}
                      className="p-2 text-gray-400 hover:text-accent">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {/* 검색 결과 드롭다운 */}
                {searchingIdx === idx && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                    {searchResults.map(u => (
                      <button key={u.id} type="button" onClick={() => linkArtist(idx, u)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                        {u.avatar ? <img src={u.avatar} className="w-6 h-6 rounded-full object-cover" /> : <div className="w-6 h-6 rounded-full bg-gray-200" />}
                        {/* 사이트에서 보이는 이름(닉네임)으로 찾고 본명을 곁들인다 — 연동 값은 본명 유지 */}
                        {displayName(u)}{u.nickname && u.nickname !== u.name ? <span className="text-xs text-gray-400">({u.name})</span> : null}
                      </button>
                    ))}
                  </div>
                )}
                {searchingIdx === idx && searchResults.length === 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 px-3 py-2 text-sm text-gray-400">
                    검색 결과가 없습니다.
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setArtists([...artists, { name: '' }])}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <Plus size={12} /> 작가 추가
            </button>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">추가 이미지 (선택, 최대 10장)</p>
            <MultiImageUpload
              images={form.additionalImages}
              onAdd={(url: string) => setForm(prev => ({ ...prev, additionalImages: [...prev.additionalImages, { url }] }))}
              onRemove={(index: number) => setForm(prev => ({ ...prev, additionalImages: prev.additionalImages.filter((_, i) => i !== index) }))}
              maxCount={10}
            />
          </div>
          {/* 약관 동의 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-40 overflow-y-auto p-3 bg-white text-xs text-gray-600 whitespace-pre-wrap">{showTerms || '약관 로딩 중...'}</div>
            <label className="flex items-center gap-2 p-3 bg-gray-100 border-t border-gray-200 cursor-pointer text-sm">
              <input type="checkbox" checked={agreedTerms} onChange={e => setAgreedTerms(e.target.checked)} className="rounded" />
              위 약관에 동의합니다
            </label>
          </div>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !agreedTerms}
            className="w-full py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {createMutation.isPending ? '등록 중...' : '전시 등록 요청'}
          </button>
          <p className="text-center text-xs text-gray-400">
            쓰던 내용은 이 브라우저에 자동으로 저장돼요{draftSavedAt ? ` · ${savedAtLabel(draftSavedAt)} 저장됨` : ''}
          </p>
        </div>
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
function approvalRequestTypeLabel(type?: string) {
  if (type === 'GALLERY_EDIT') return '갤러리 수정';
  if (type === 'EXHIBITION_EDIT') return '공모 수정';
  return type || '수정 요청';
}

function parseApprovalChanges(changes: unknown): Record<string, unknown> {
  if (!changes) return {};
  if (typeof changes === 'object') return changes as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(changes));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function formatApprovalChangeValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (value instanceof Date) return value.toLocaleString('ko');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ApprovalsSection() {
  const queryClient = useQueryClient();
  // 모든 useState/useQuery/useMutation 훅은 조건부 return 전에 선언 (React 훅 규칙)
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<{ type: string; id: number } | null>(null);
  const [adminTab, setAdminTab] = useState<'pending' | 'manage'>('pending');
  // 삭제 요청 승인 확인 — 무엇이 사라지는지 적은 창을 거친다(되돌릴 수 없다)
  const [approvingDelete, setApprovingDelete] = useState<any>(null);

  const { data, isLoading } = useQuery<{ pendingGalleries: any[]; pendingExhibitions: any[]; pendingShows: any[]; pendingRequests: any[] }>({
    queryKey: ['approvals'],
    queryFn: () => api.get('/approvals').then(r => r.data),
    staleTime: 0, // 승인 큐는 항상 최신 데이터 사용
    refetchOnMount: 'always', // 탭 전환 시에도 반드시 refetch
  });

  // 승인된 갤러리/공모 조회 (Admin 삭제용)
  const { data: allGalleries = [] } = useQuery<any[]>({
    queryKey: ['admin-all-galleries'],
    queryFn: () => api.get('/galleries').then(r => r.data),
  });

  const { data: allExhibitions = [] } = useQuery<any[]>({
    queryKey: ['admin-all-exhibitions'],
    queryFn: () => api.get('/exhibitions').then(r => r.data),
  });

  const { data: allShows = [] } = useQuery<any[]>({
    queryKey: ['admin-all-shows'],
    queryFn: () => api.get('/shows').then(r => r.data),
  });

  const invalidateAllRelated = () => {
    // refetchType: 'all' → 비활성(언마운트) 쿼리도 stale 마킹하여 다음 마운트 시 즉시 refetch
    const opts = { refetchType: 'all' as const };
    queryClient.invalidateQueries({ queryKey: ['approvals'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['my-galleries'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['galleries'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['my-exhibitions'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['exhibitions'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['admin-all-galleries'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['admin-all-exhibitions'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['my-shows'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['shows'], ...opts });
    queryClient.invalidateQueries({ queryKey: ['admin-all-shows'], ...opts });
  };

  const approveMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      api.patch(`/approvals/${type}/${id}`, { status: 'APPROVED' }),
    onSuccess: (res: any, v) => {
      invalidateAllRelated();
      if (v.type === 'delete-request') {
        queryClient.invalidateQueries({ queryKey: ['my-operation-overview'], refetchType: 'all' });
        toast.success(res?.data?.alreadyGone ? '이미 지워진 대상이라 요청만 정리했습니다.' : '삭제 요청을 승인해 삭제했습니다. 요청한 갤러리와 참여 작가에게 알림이 갑니다.');
      } else toast.success('승인되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '승인에 실패했습니다.'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ type, id, reason }: { type: string; id: number; reason: string }) =>
      api.patch(`/approvals/${type}/${id}`, { status: 'REJECTED', rejectReason: reason }),
    onSuccess: () => {
      invalidateAllRelated();
      setRejectingId(null);
      setRejectReason('');
      toast.success('거절되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '거절에 실패했습니다.'),
  });

  // Admin: 갤러리 삭제
  const deleteGalleryMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/galleries/${id}`),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('갤러리가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // Admin: 공모 삭제
  const deleteExhibitionMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('공모가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // Admin: 전시 삭제
  const deleteShowMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/shows/${id}`),
    onSuccess: () => {
      invalidateAllRelated();
      toast.success('전시가 삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  // 로딩 상태 (모든 훅 선언 후에 조건부 return)
  if (isLoading) return <div className="h-32 bg-gray-100 animate-pulse" />;

  const allPending = [
    ...(data?.pendingGalleries?.map(g => ({ ...g, _type: 'gallery' })) || []),
    ...(data?.pendingExhibitions?.map(e => ({ ...e, _type: 'exhibition' })) || []),
    ...(data?.pendingShows?.map(s => ({ ...s, _type: 'show' })) || []),
    // 삭제 요청(2026-10-03)은 같은 표(ApprovalRequest)에 들어오지만 처리하는 길이 다르다 — `/approvals/delete-request/:id`
    ...(data?.pendingRequests?.map(r => ({ ...r, _type: r.type === 'EXHIBITION_DELETE' || r.type === 'GALLERY_DELETE' ? 'delete-request' : 'edit-request' })) || []),
  ];
  const deleteRequestDetails = (item: any): string[] => {
    const t = item?.target;
    if (!t || t.gone) return ['이미 지워진 대상이에요. 요청만 정리합니다.'];
    const lines = item.type === 'EXHIBITION_DELETE'
      ? [`공모 「${t.name}」${t.galleryName ? ` (${t.galleryName})` : ''}을 지웁니다.`]
      : [`갤러리 「${t.name}」와 그 갤러리의 공모 ${t.exhibitions}건을 지웁니다.`];
    lines.push(`수락한 작가 ${t.accepted}명 · 출품 자료 ${t.submissions}건 · 판매 ${t.sales}건${t.settled ? ` · 정산 완료 ${typeof t.settled === 'number' ? `${t.settled}건` : ''}` : t.settlementRequested ? ' · 정산 확인 진행 중' : ''}이 함께 사라져요.`);
    lines.push('참여 작가와 요청한 갤러리에게 알림이 가요. 되돌릴 수 없어요.');
    return lines;
  };

  return (
    <div>
      {/* Admin 서브탭 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setAdminTab('pending')} className={`px-3 py-1.5 text-sm rounded-full ${adminTab === 'pending' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
          승인 대기 ({allPending.length})
        </button>
        <button onClick={() => setAdminTab('manage')} className={`px-3 py-1.5 text-sm rounded-full ${adminTab === 'manage' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
          등록 관리
        </button>
      </div>

      {/* 등록 관리 탭 - 승인된 갤러리/공모 삭제 */}
      {adminTab === 'manage' && (
        <div className="space-y-6">
          <div>
            <h4 className="font-medium text-sm mb-2 text-gray-700">등록된 갤러리 ({allGalleries.length})</h4>
            {allGalleries.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">등록된 갤러리가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {allGalleries.map((g: any) => (
                  <div key={g.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{g.name}</p>
                      <p className="text-xs text-gray-500">{g.address} · {regionLabels[g.region]}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${g.name}" 갤러리를 삭제하시겠습니까? 관련 공모, 리뷰 등 모든 데이터가 삭제됩니다.`)) {
                          deleteGalleryMutation.mutate(g.id);
                        }
                      }}
                      className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-accent"
                      aria-label="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2 text-gray-700">진행중인 공모 ({allExhibitions.length})</h4>
            {allExhibitions.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">진행중인 공모가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {allExhibitions.map((ex: any) => (
                  <div key={ex.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{ex.title}</p>
                      <p className="text-xs text-gray-500">{ex.gallery?.name} · {exhibitionTypeLabels[ex.type]}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${ex.title}" 공모를 삭제하시겠습니까?`)) {
                          deleteExhibitionMutation.mutate(ex.id);
                        }
                      }}
                      className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-accent"
                      aria-label="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2 text-gray-700">등록된 전시 ({allShows.length})</h4>
            {allShows.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">등록된 전시가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {allShows.map((s: any) => (
                  <div key={s.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-gray-500">{s.gallery?.name} · {regionLabels[s.region]}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${s.title}" 전시를 삭제하시겠습니까?`)) {
                          deleteShowMutation.mutate(s.id);
                        }
                      }}
                      className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-accent"
                      aria-label="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {adminTab === 'pending' && <>
      <h3 className="font-semibold mb-4">승인 대기 목록 ({allPending.length})</h3>
      {allPending.length === 0 ? (
        <p className="text-gray-400 text-center py-8">대기중인 승인 요청이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {allPending.map(item => (
            <div key={`${item._type}-${item.id}`} className="p-4 border border-gray-100 rounded-xl">
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {item._type === 'gallery' ? '갤러리' : item._type === 'exhibition' ? '공모' : item._type === 'show' ? '전시'
                  : item._type === 'delete-request' ? (item.type === 'EXHIBITION_DELETE' ? '공모 삭제 요청' : '갤러리 삭제 요청') : '수정 요청'}
              </span>
              <h4 className="font-medium mt-1">{item.name || item.title || item.target?.name || String(parseApprovalChanges(item.changes).title ?? '') || `#${item.targetId}`}</h4>
              {item._type === 'gallery' && (
                <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                  <p>주소: {item.address}</p>
                  <p>전화: {item.phone} · 대표: {item.ownerName}</p>
                  <p>지역: {regionLabels[item.region]}</p>
                  {item.instagramUrl && <p className="break-all">인스타: {item.instagramUrl}</p>}
                  {item.email && <p className="break-all">이메일: {item.email}</p>}
                  {item.mainImage && <img src={item.mainImage} alt="" className="w-full h-32 object-cover rounded-lg mt-2" />}
                </div>
              )}
              {item._type === 'exhibition' && (
                <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                  <p>갤러리: {item.gallery?.name} ({regionLabels[item.gallery?.region] || item.region})</p>
                  <p>유형: {exhibitionTypeLabels[item.type]} · 모집 {item.capacity}명 · 지역: {regionLabels[item.region]}</p>
                  <p>공모 기간: {item.deadlineStart ? new Date(item.deadlineStart).toLocaleDateString('ko') + ' ~ ' : ''}{new Date(item.deadline).toLocaleDateString('ko')}</p>
                  <p>전시 기간: {item.exhibitStartDate ? new Date(item.exhibitStartDate).toLocaleDateString('ko') + ' ~ ' : ''}{new Date(item.exhibitDate).toLocaleDateString('ko')}</p>
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full h-32 object-cover rounded-lg mt-2" />}
                </div>
              )}
              {item._type === 'show' && (
                <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                  <p>갤러리: {item.gallery?.name} ({regionLabels[item.gallery?.region] || item.region})</p>
                  <p>전시 기간: {new Date(item.startDate).toLocaleDateString('ko')} ~ {new Date(item.endDate).toLocaleDateString('ko')}</p>
                  <p>관람: {item.openingHours} · 입장료: {item.admissionFee}</p>
                  <p>위치: {item.location} · 지역: {regionLabels[item.region]}</p>
                  {item.posterImage && <img src={item.posterImage} alt="" className="w-full h-32 object-cover rounded-lg mt-2" />}
                </div>
              )}
              {item._type === 'delete-request' && (
                <div className="mt-1 space-y-1 text-sm text-gray-500">
                  <p>요청자: {item.requester?.name || `User #${item.requesterId}`}{item.requester?.email ? ` (${item.requester.email})` : ''} · {new Date(item.createdAt).toLocaleString('ko')}</p>
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-gray-700">사유: {String(parseApprovalChanges(item.changes).reason ?? '') || '—'}</p>
                  {item.target?.gone ? (
                    <p className="text-xs text-gray-500">이미 지워진 대상이에요 — [삭제 승인]을 누르면 요청만 정리해요.</p>
                  ) : (
                    <p className="text-xs text-gray-600">
                      지우면 함께 사라지는 것 · 수락한 작가 {item.target?.accepted ?? 0}명 · 출품 자료 {item.target?.submissions ?? 0}건 · 판매 {item.target?.sales ?? 0}건
                      {item.type === 'GALLERY_DELETE' ? ` · 공모 ${item.target?.exhibitions ?? 0}건` : ''}
                    </p>
                  )}
                </div>
              )}
              {item._type === 'edit-request' && (
                <div className="text-sm text-gray-500 space-y-1 mt-1">
                  <p>유형: {approvalRequestTypeLabel(item.type)} · 대상 ID: {item.targetId}</p>
                  <p>요청자: {item.requester?.name || `User #${item.requesterId}`}{item.requester?.email ? ` (${item.requester.email})` : ''}</p>
                  <p>요청일: {new Date(item.createdAt).toLocaleString('ko')}</p>
                  <div className="mt-2 rounded-lg bg-gray-50 p-2">
                    <p className="text-xs font-medium text-gray-600 mb-1">변경 요청 내용</p>
                    {Object.entries(parseApprovalChanges(item.changes)).length === 0 ? (
                      <p className="text-xs text-gray-400">표시할 변경 내용이 없습니다.</p>
                    ) : (
                      <dl className="space-y-1">
                        {/* minmax(0,1fr) + break-all 필수 — 값에 긴 URL(mainImage 등)이 오면
                            1fr(=minmax(auto,1fr))의 auto 최소폭이 URL 전체 폭으로 잡혀 탭이 가로로 밀림 */}
                        {Object.entries(parseApprovalChanges(item.changes)).map(([key, value]) => (
                          <div key={key} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-xs">
                            <dt className="text-gray-400">{key}</dt>
                            <dd className="text-gray-700 break-all">{formatApprovalChangeValue(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </div>
              )}
              {/* 공모·전시 소개는 서식 있는 글일 수 있다(2026-10-03) — 걸러서 그린다. 옛 평범한 글은 줄바꿈 그대로 */}
              {item.description && <RichText value={item.description} className="text-sm text-gray-600 mt-2 bg-gray-50 p-2 rounded" />}

              {rejectingId?.type === item._type && rejectingId?.id === item.id ? (
                <div className="mt-3 space-y-2">
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="거절 사유를 입력하세요 (필수)" className="w-full h-20 p-2 border border-gray-200 rounded-lg text-sm resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => rejectMutation.mutate({ type: item._type, id: item.id, reason: rejectReason })} disabled={!rejectReason.trim() || approveMutation.isPending || rejectMutation.isPending} className="px-3 py-1.5 bg-accent text-white text-sm rounded-lg disabled:opacity-50">거절 확인</button>
                    <button onClick={() => setRejectingId(null)} className="px-3 py-1.5 text-sm text-gray-500">취소</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => (item._type === 'delete-request' ? setApprovingDelete(item) : approveMutation.mutate({ type: item._type, id: item.id }))} disabled={approveMutation.isPending || rejectMutation.isPending} className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg flex items-center gap-1 disabled:opacity-50"><Check size={14} /> {item._type === 'delete-request' ? '삭제 승인' : '승인'}</button>
                  <button onClick={() => { setRejectReason(''); setRejectingId({ type: item._type, id: item.id }); }} disabled={approveMutation.isPending || rejectMutation.isPending} className="px-3 py-1.5 bg-accent/5 text-accent text-sm rounded-lg flex items-center gap-1 disabled:opacity-50"><XCircle size={14} /> 거절</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </>}
      <ConfirmDialog
        open={!!approvingDelete}
        title={approvingDelete?.type === 'GALLERY_DELETE' ? '갤러리를 삭제할까요?' : '공모를 삭제할까요?'}
        details={deleteRequestDetails(approvingDelete)}
        confirmText="삭제 승인"
        variant="danger"
        onConfirm={() => { const it = approvingDelete; setApprovingDelete(null); if (it) approveMutation.mutate({ type: 'delete-request', id: it.id }); }}
        onCancel={() => setApprovingDelete(null)}
      />
    </div>
  );
}

// ========== Admin: 히어로 슬라이드 관리 ==========
function HeroManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', description: '', imageUrl: '', mobileImageUrl: '', linkUrl: '', order: 0 });
  const [preview, setPreview] = useState(false);

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
    setForm({ title: '', description: '', imageUrl: '', mobileImageUrl: '', linkUrl: '', order: 0 });
    setPreview(false);
  };

  const startEdit = (s: any) => {
    setForm({ title: s.title, description: s.description || '', imageUrl: s.imageUrl, mobileImageUrl: s.mobileImageUrl || '', linkUrl: s.linkUrl || '', order: s.order });
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
                <div className="absolute bottom-3 left-3">
                  <p className="text-white font-bold text-sm drop-shadow">{form.title || '제목'}</p>
                  <p className="text-white/80 text-xs drop-shadow">{form.description || '설명'}</p>
                </div>
                {form.linkUrl && <span className="absolute bottom-3 right-3 text-xs bg-white text-gray-900 px-2 py-1 rounded">바로가기 →</span>}
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

// ========== Admin: 혜택 관리 ==========
function BenefitManageSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', description: '', imageUrl: '', linkUrl: '' });
  const [preview, setPreview] = useState(false);

  const { data: benefits = [] } = useQuery<any[]>({
    queryKey: ['benefits'],
    queryFn: () => api.get('/benefits').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/benefits', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benefits'] });
      resetForm();
      toast.success('혜택이 등록되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '혜택 등록에 실패했습니다.'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/benefits/${editingId}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benefits'] });
      resetForm();
      toast.success('혜택이 수정되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '혜택 수정에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/benefits/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benefits'] });
      toast.success('혜택이 삭제되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '혜택 삭제에 실패했습니다.'),
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: '', description: '', imageUrl: '', linkUrl: '' });
    setPreview(false);
  };

  const startEdit = (b: any) => {
    setForm({ title: b.title, description: b.description, imageUrl: b.imageUrl || '', linkUrl: b.linkUrl || '' });
    setEditingId(b.id);
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">혜택 목록 ({benefits.length}개)</h3>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg">
          <Plus size={14} /> 새 혜택
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl space-y-3">
          <h4 className="font-medium text-sm">{editingId ? '혜택 수정' : '새 혜택 등록'}</h4>
          <input placeholder="제목 *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <textarea placeholder="설명 *" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
          <input placeholder="링크 URL (선택)" value={form.linkUrl} onChange={e => setForm({...form, linkUrl: e.target.value})} className="w-full p-2.5 border border-gray-200 rounded-lg text-sm" />
          <ImageUpload value={form.imageUrl} onChange={(url) => setForm({...form, imageUrl: url})} onRemove={() => setForm({...form, imageUrl: ''})} placeholder="혜택 이미지 업로드" />

          <button onClick={() => setPreview(!preview)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900">
            <Eye size={14} /> {preview ? '미리보기 닫기' : '미리보기'}
          </button>
          {preview && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {form.imageUrl && <img src={form.imageUrl} alt="" className="w-full h-32 object-cover" />}
              <div className="p-3">
                <p className="font-semibold text-sm">{form.title || '제목'}</p>
                <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap break-words">{form.description || '설명'}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!form.title || !form.description) { toast.error('제목과 설명은 필수입니다.'); return; }
                editingId ? updateMutation.mutate() : createMutation.mutate();
              }}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
            >{editingId ? '수정' : '등록'}</button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {benefits.map((b: any) => (
          <div key={b.id} className="flex gap-3 p-3 border border-gray-100 rounded-xl items-center">
            {b.imageUrl && <img src={b.imageUrl} alt="" className="w-20 h-14 object-cover rounded-lg flex-none" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{b.title}</p>
              <p className="text-xs text-gray-500 truncate">{b.description}</p>
            </div>
            <div className="flex gap-1 flex-none">
              <button onClick={() => startEdit(b)} className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-900" aria-label="수정"><Edit3 size={14} /></button>
              <ConfirmDeleteButton onConfirm={() => deleteMutation.mutate(b.id)} title="혜택 삭제" message="이 혜택을 지웁니다. 되돌릴 수 없습니다." className="min-h-[44px] min-w-[44px] -m-2 shrink-0 flex items-center justify-center text-gray-400 hover:text-accent"><Trash2 size={14} /></ConfirmDeleteButton>
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
function ReportManageSection() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [adminNote, setAdminNote] = useState('');

  const { data: reports = [], isLoading } = useQuery<any[]>({
    queryKey: ['admin-reports', statusFilter],
    queryFn: () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return api.get(`/reports${params}`).then(r => r.data);
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, status, adminNote, deleteMessage }: { id: number; status: string; adminNote?: string; deleteMessage?: boolean }) =>
      api.patch(`/reports/${id}`, { status, adminNote, deleteMessage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
      setExpandedId(null);
      setAdminNote('');
      toast.success('신고가 처리되었습니다.');
    },
    onError: () => toast.error('처리에 실패했습니다.'),
  });

  const statusLabels: Record<string, string> = { PENDING: '대기', DISMISSED: '반려', ACTIONED: '제재' };
  const reasonLabels: Record<string, string> = { PROFANITY: '비속어', SPAM: '스팸', INAPPROPRIATE: '부적절', OTHER: '기타' };

  if (isLoading) return <div className="h-32 bg-gray-100 animate-pulse" />;

  return (
    <div>
      <div className="flex gap-3 mb-6">
        {[
          { label: '전체', value: null },
          { label: '대기', value: 'PENDING' },
          { label: '반려', value: 'DISMISSED' },
          { label: '제재', value: 'ACTIONED' },
        ].map(f => (
          <button
            key={f.label}
            onClick={() => setStatusFilter(f.value)}
            className={`text-sm cursor-pointer transition-colors ${
              statusFilter === f.value
                ? 'text-gray-900 underline underline-offset-4 decoration-1'
                : 'text-gray-400 hover:text-gray-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {reports.length === 0 ? (
        <p className="text-gray-400 text-center py-8">신고 내역이 없습니다.</p>
      ) : (
        <div className="space-y-0">
          {reports.map((r: any) => (
            <div key={r.id} className="py-4 border-b border-gray-100">
              <div className="flex justify-between items-start cursor-pointer" onClick={() => { setAdminNote(''); setExpandedId(expandedId === r.id ? null : r.id); }}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${r.status === 'PENDING' ? 'text-accent' : r.status === 'ACTIONED' ? 'text-gray-900' : 'text-gray-400'}`}>
                      {statusLabels[r.status] || r.status}
                    </span>
                    <span className="text-xs text-gray-400">{reasonLabels[r.reason] || r.reason}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{r.reporter?.name}이(가) {r.message?.sender?.name}의 메시지를 신고</p>
                  {r.detail && <p className="text-xs text-gray-400 mt-0.5">{r.detail}</p>}
                </div>
                <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString('ko')}</span>
              </div>
              {expandedId === r.id && (
                <div className="mt-3 space-y-3 pl-4 border-l-2 border-gray-200">
                  {r.message && (
                    <div className="text-sm">
                      <p className="text-xs text-gray-400">원본 메시지</p>
                      <p className="text-gray-600 mt-1">제목: {r.message.subject}</p>
                      <p className="text-gray-600">내용: {r.message.content}</p>
                      <p className="text-xs text-gray-400 mt-1">{r.message.sender?.name} → {r.message.receiver?.name}</p>
                    </div>
                  )}
                  {r.status === 'PENDING' && (
                    <div className="space-y-2">
                      <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="관리자 메모 (선택)" className="w-full h-16 p-2 border border-gray-200 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-gray-400" />
                      <div className="flex gap-2">
                        <button onClick={() => actionMutation.mutate({ id: r.id, status: 'DISMISSED', adminNote })} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900">반려</button>
                        <button onClick={() => actionMutation.mutate({ id: r.id, status: 'ACTIONED', adminNote })} className="px-3 py-1.5 text-sm bg-gray-900 text-white">제재</button>
                        <button onClick={() => actionMutation.mutate({ id: r.id, status: 'ACTIONED', adminNote, deleteMessage: true })} className="px-3 py-1.5 text-sm text-accent hover:underline">제재 + 삭제</button>
                      </div>
                    </div>
                  )}
                  {r.status !== 'PENDING' && r.adminNote && <p className="text-xs text-gray-400">관리자 메모: {r.adminNote}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Admin: 사용자 관리 (검색 + 역할 변경) ==========
const ADMIN_USER_GALLERY_STATUS_LABELS: Record<string, string> = { PENDING: '승인대기', APPROVED: '승인', REJECTED: '거절', WITHDRAWN: '탈퇴' };
// ⚠️ 역할이 늘면 여기와 아래 <select> 옵션에 함께 넣을 것 — VISITOR('일반', 2026-09-16)가 빠져 있어 관리자가 일반 회원을
//    검색조차 못 했다(2026-09-19 수정). 라벨은 `roleLabel()` 하나를 쓴다(규칙 52).
const ADMIN_USER_ROLE_TABS = [
  { role: 'GALLERY', label: '갤러리 유저' },
  { role: 'ARTIST', label: '아티스트 유저' },
  { role: 'VISITOR', label: '일반 유저' },
  { role: 'ADMIN', label: 'admin 유저' },
] as const;
const adminUserDate = (value?: string | null) => {
  if (!value) return '기록 없음';
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};
const adminUserDateTime = (value?: string | null) => {
  if (!value) return '기록 없음';
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function UserManageSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [activeRole, setActiveRole] = useState<(typeof ADMIN_USER_ROLE_TABS)[number]['role']>('GALLERY');

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ['admin-users', activeRole, submitted],
    queryFn: () => {
      const params = new URLSearchParams({ role: activeRole });
      if (submitted) params.set('q', submitted);
      return api.get(`/admin/users?${params.toString()}`).then(r => r.data);
    },
    staleTime: 0,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => api.patch(`/admin/users/${id}/role`, { role }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); toast.success('역할이 변경되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '역할 변경에 실패했습니다.'),
  });

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }} className="flex gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일 또는 이름으로 검색"
          className="min-w-0 flex-1 p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
        <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">검색</button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {ADMIN_USER_ROLE_TABS.map((tab) => {
          const selected = activeRole === tab.role;
          return (
            <button
              key={tab.role}
              type="button"
              onClick={() => setActiveRole(tab.role)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                selected
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="h-20 bg-gray-100 animate-pulse rounded-lg" />
      ) : users.length === 0 ? (
        <p className="text-gray-400 text-center py-8 text-sm">검색 결과가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const isMe = me?.id === u.id;
            const isArtist = u.role === 'ARTIST';
            const isGallery = u.role === 'GALLERY';
            const ownedGalleries = Array.isArray(u.galleries) ? u.galleries : [];
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 p-3 border border-gray-100 rounded-lg">
                <div className="min-w-0">
                  <button
                    type="button"
                    disabled={!isArtist && !(isGallery && ownedGalleries.length === 1)}
                    onClick={() => {
                      if (isArtist) navigate(`/portfolio/${u.id}`);
                      if (isGallery && ownedGalleries.length === 1) navigate(`/galleries/${ownedGalleries[0].id}`);
                    }}
                    className={`block max-w-full truncate text-left text-sm font-medium ${isArtist || (isGallery && ownedGalleries.length === 1) ? 'text-gray-900 hover:underline' : 'text-gray-900 cursor-default'}`}
                    title={isArtist ? '작가 포트폴리오 보기' : isGallery && ownedGalleries.length === 1 ? '갤러리 보기' : undefined}
                  >
                    {u.name}{isMe && <span className="text-xs text-gray-400"> (나)</span>}
                  </button>
                  <p className="text-xs text-gray-500 truncate">
                    {u.email}
                    {isGallery && <span> · 갤러리 {ownedGalleries.length}개</span>}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    가입일 {adminUserDate(u.createdAt)} · 최근 접속 {adminUserDateTime(u.lastSeenAt)}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <span className="hidden sm:inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                    {roleLabel(u.role) || u.role}
                  </span>
                  {isArtist && (
                    <button
                      type="button"
                      onClick={() => navigate(`/portfolio/${u.id}`)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      <ExternalLink size={13} /> 포트폴리오
                    </button>
                  )}
                  {isGallery && ownedGalleries.length === 1 && (
                    <button
                      type="button"
                      onClick={() => navigate(`/galleries/${ownedGalleries[0].id}`)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      <Building2 size={13} /> 갤러리
                    </button>
                  )}
                  {isGallery && ownedGalleries.length > 1 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) navigate(`/galleries/${e.target.value}`);
                      }}
                      className="max-w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400"
                      title="소유 갤러리 선택"
                    >
                      <option value="">갤러리 선택</option>
                      {ownedGalleries.map((g: any) => (
                        <option key={g.id} value={g.id}>
                          {g.name} · {ADMIN_USER_GALLERY_STATUS_LABELS[g.status] || g.status}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={u.role}
                    disabled={isMe || u.role === 'ADMIN' || roleMutation.isPending}
                    onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value })}
                    title={isMe ? '본인 역할은 변경할 수 없습니다' : u.role === 'ADMIN' ? '관리자 계정은 강등/변경할 수 없습니다' : '역할 변경'}
                    className="text-sm px-2 py-1.5 border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="ARTIST">아티스트</option>
                    <option value="GALLERY">갤러리</option>
                    <option value="VISITOR">일반</option>
                    <option value="ADMIN">관리자</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        ※ 본인 및 다른 관리자 계정은 안전을 위해 강등/변경할 수 없습니다. 최근 접속은 이 기능 배포 후 인증된 요청이 들어온 시점부터 기록됩니다.
      </p>
    </div>
  );
}

// ========== Admin: 운영 조회 (지원현황/작가이력/갤러리 게시물) ==========
const OV_STATUS_COLORS: Record<string, string> = { SUBMITTED: 'bg-gray-100 text-gray-600', ACCEPTED: 'bg-green-100 text-green-600', REJECTED: 'bg-accent/10 text-accent' };
const OV_STATUS_LABELS: Record<string, string> = { SUBMITTED: '접수', REVIEWED: '접수', ACCEPTED: '수락', REJECTED: '거절' };
const POST_STATUS_COLORS: Record<string, string> = { PENDING: 'bg-yellow-100 text-yellow-700', APPROVED: 'bg-green-100 text-green-600', REJECTED: 'bg-accent/10 text-accent' };
const POST_STATUS_LABELS: Record<string, string> = { PENDING: '승인대기', APPROVED: '승인', REJECTED: '거절' };
const ovDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ko') : '-');

function OvBadge({ status, kind = 'app' }: { status: string; kind?: 'app' | 'post' }) {
  const colors = kind === 'post' ? POST_STATUS_COLORS : OV_STATUS_COLORS;
  const labels = kind === 'post' ? POST_STATUS_LABELS : OV_STATUS_LABELS;
  return <span className={`px-2 py-0.5 text-xs rounded-full flex-none ${colors[status] || 'bg-gray-100 text-gray-600'}`}>{labels[status] || status}</span>;
}

function OvCounts({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex gap-1.5 flex-wrap text-xs">
      {[['ALL', '전체'], ['SUBMITTED', '접수'], ['ACCEPTED', '수락'], ['REJECTED', '거절']].map(([k, l]) => (
        <span key={k} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{l} {counts[k] ?? 0}</span>
      ))}
    </div>
  );
}

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

function OversightSection() {
  const [view, setView] = useState<'exhibition' | 'artist' | 'gallery'>('exhibition');
  const tabs = [{ k: 'exhibition', l: '공모 지원현황' }, { k: 'artist', l: '작가 지원이력' }, { k: 'gallery', l: '갤러리 게시물' }] as const;
  return (
    <div>
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setView(t.k)}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${view === t.k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t.l}
          </button>
        ))}
      </div>
      {view === 'exhibition' && <OvExhibitions />}
      {view === 'artist' && <OvArtists />}
      {view === 'gallery' && <OvGalleries />}
    </div>
  );
}

// --- 공모 지원현황 ---
function OvExhibitions() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  /*
    `?ex=<id>` 로 들어오면 그 공모를 고른 채로 연다(2026-10-02) — 운영 화면의 [← 운영 조회]·[지원자 보기] 가 이 주소를 쓴다
    (lib/operationLinks.ts). 관리자가 갤러리 주최 공모의 지원자를 보는 곳은 여기다(조회 전용).
    처음 한 번만 읽는다(초깃값) — 그 뒤로는 관리자가 누른 대로 따른다.
  */
  const linkedExId = useRef(Number(searchParams.get('ex')) || null).current;
  const [selId, setSelId] = useState<number | null>(linkedExId);
  const [expanded, setExpanded] = useState<number | null>(null);
  // 진행/종료 필터 — 갤러리 마이페이지(내 공모)와 **같은 기준**을 쓴다.
  // 판정은 서버(`lib/exhibitionLifecycle.ts`)가 내려주는 `closed`: 정산 완료 또는
  // 전시 종료 20일 경과(정산을 시작했으면 진행중 유지).
  // 전시종료는 아직 정산이 남아 할 일이 있으므로 진행중에 둔다. 기준이 갈리면 두 화면의 숫자가 달라진다.
  const [scope, setScope] = useState<'active' | 'closed'>('active');

  const { data: exhibitions = [], isLoading } = useQuery<any[]>({
    queryKey: ['ov-exhibitions', submitted],
    queryFn: () => api.get(`/admin/exhibitions${submitted ? `?q=${encodeURIComponent(submitted)}` : ''}`).then(r => r.data),
    staleTime: 0,
  });
  const { data: detail } = useQuery<any>({
    queryKey: ['ov-ex-apps', selId],
    queryFn: () => api.get(`/admin/exhibitions/${selId}/applications`).then(r => r.data),
    enabled: !!selId,
  });


  // 검색 결과 안에서 나눈다 — 검색어를 지운 채 탭만 바꾸면 전체가 다시 갈린다
  const isClosedEx = (ex: any) => ex.closed ?? !!ex.settledAt;
  // 가리켜 들어온 공모가 '종료' 쪽이면 그 목록으로 바꿔 준다(안 그러면 고른 줄이 목록에 없다). 한 번만.
  const scopeSynced = useRef(false);
  useEffect(() => {
    if (!linkedExId || scopeSynced.current || exhibitions.length === 0) return;
    scopeSynced.current = true;
    const hit = exhibitions.find((ex: any) => ex.id === linkedExId);
    if (hit && isClosedEx(hit)) setScope('closed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhibitions, linkedExId]);
  // 지원 현황은 목록(최대 100줄) 아래에 있다 — 가리켜 들어왔으면 거기로 내려 준다. 한 번만.
  // ⚠️ '했다' 표시는 **실제로 내린 뒤에**(타이머 안에서) 세운다. 먼저 세우면 개발 모드(StrictMode)가 effect 를 두 번 돌릴 때
  //    첫 번째가 표시만 남긴 채 타이머를 치우고, 두 번째는 표시를 보고 그냥 나간다 — 캐시가 따뜻할 때(운영 조회 → 운영 페이지 → 돌아옴)만 안 내려간다.
  const detailRef = useRef<HTMLDivElement>(null);
  const detailScrolled = useRef(false);
  useEffect(() => {
    // 목록까지 받은 뒤에 내린다 — 지원 현황이 먼저 오면, 뒤늦게 그려지는 목록(최대 100줄)이 그걸 다시 화면 밖으로 밀어낸다
    if (!linkedExId || detailScrolled.current || !detail || isLoading || selId !== linkedExId) return;
    const t = window.setTimeout(() => {
      if (!detailRef.current) return;
      detailScrolled.current = true;
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(t);
  }, [detail, selId, linkedExId, isLoading]);
  const activeList = exhibitions.filter((ex) => !isClosedEx(ex));
  const closedList = exhibitions
    .filter(isClosedEx)
    .sort((a: any, b: any) => new Date(b.settledAt ?? b.exhibitDate ?? 0).getTime() - new Date(a.settledAt ?? a.exhibitDate ?? 0).getTime());
  const shown = scope === 'closed' ? closedList : activeList;

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); setSelId(null); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="공모 제목 검색 (비우면 전체)"
          className="min-w-0 flex-1 p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
        <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">검색</button>
      </form>

      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        {([['active', '진행중인 공모', activeList.length], ['closed', '종료된 공모', closedList.length]] as const).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setScope(k); setSelId(null); setExpanded(null); }}
            className={`rounded-md px-3 py-1.5 text-sm transition ${scope === k ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            {label} {n > 0 && <span className="text-gray-400">{n}</span>}
          </button>
        ))}
      </div>

      {isLoading ? <div className="h-16 bg-gray-100 animate-pulse rounded-lg" /> : shown.length === 0 ? (
        <p className="text-gray-500 text-center py-6 text-sm">
          {scope === 'closed' ? '정산까지 끝난 공모가 없습니다.' : exhibitions.length > 0 ? '진행중인 공모가 없습니다.' : '공모가 없습니다.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((ex) => (
            <button key={ex.id} onClick={() => { setSelId(ex.id); setExpanded(null); }}
              className={`w-full text-left p-3 border rounded-lg flex items-center justify-between gap-2 transition-colors ${selId === ex.id ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-300'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{ex.title}</p>
                <p className="text-xs text-gray-500 truncate">{ex.gallery?.name} · 마감 {ovDate(ex.deadline)}</p>
              </div>
              <div className="flex items-center gap-2 flex-none">
                {ex.settledAt
                  ? <span className="shrink-0 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">정산 완료</span>
                  : ex.ended && <span className="shrink-0 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">정산 단계</span>}
                <OvBadge status={ex.status} kind="post" />
                <span className="text-xs text-gray-500">지원 {ex._count?.applications ?? 0}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selId && detail && (
        <div ref={detailRef} data-testid="ov-ex-detail" className="scroll-mt-24 border-t border-gray-200 pt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">{detail.exhibition.title} — 지원 현황</p>
            <button
              onClick={() => navigate(`/exhibitions/${selId}/operation/new`)}
              className="text-xs text-gray-900 font-medium hover:underline flex items-center gap-1 shrink-0"
            >
              <ClipboardList size={12} /> 운영 페이지
            </button>
          </div>
          <OvCounts counts={detail.counts} />
          {detail.applications.length === 0 ? (
            <p className="text-gray-400 text-center py-4 text-sm">지원자가 없습니다.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.applications.map((app: any) => {
                const isOpen = expanded === app.id;
                return (
                  <div key={app.id} className={`border rounded-lg ${app.isFirstApplication ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
                    <button onClick={() => setExpanded(isOpen ? null : app.id)} className="w-full text-left p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-900 truncate">{nameWithNickname(app.user)}</p>
                          {app.isFirstApplication ? (
                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap flex-none">★ 첫 지원</span>
                          ) : (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap flex-none">이 갤러리 {app.galleryApplicationOrder}번째</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{app.user.email} · 지원 {ovDate(app.appliedAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-none">
                        <OvBadge status={app.status} />
                        {(app.status === 'ACCEPTED' || app.status === 'REJECTED') && (
                          <span className="text-xs text-gray-400">{ovDate(app.decidedAt)} 결정</span>
                        )}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-gray-50 pt-2">
                        <ApplicationContent app={app} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- 작가 지원이력 ---
function OvArtists() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selId, setSelId] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ['ov-users', submitted],
    queryFn: () => api.get(`/admin/users${submitted ? `?q=${encodeURIComponent(submitted)}` : ''}`).then(r => r.data),
    staleTime: 0,
  });
  const { data: detail } = useQuery<any>({
    queryKey: ['ov-user-apps', selId],
    queryFn: () => api.get(`/admin/users/${selId}/applications`).then(r => r.data),
    enabled: !!selId,
  });

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); setSelId(null); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="작가 이름/이메일 검색"
          className="min-w-0 flex-1 p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
        <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">검색</button>
      </form>

      {isLoading ? <div className="h-16 bg-gray-100 animate-pulse rounded-lg" /> : users.length === 0 ? (
        <p className="text-gray-400 text-center py-6 text-sm">검색 결과가 없습니다.</p>
      ) : (
        <div className="space-y-1.5">
          {users.filter((u) => u.role === 'ARTIST').map((u) => (
            <button key={u.id} onClick={() => setSelId(u.id)}
              className={`w-full text-left p-3 border rounded-lg flex items-center justify-between gap-2 transition-colors ${selId === u.id ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-300'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                <p className="text-xs text-gray-500 truncate">{u.email}</p>
              </div>
              <span className="text-xs text-gray-400 flex-none">작가</span>
            </button>
          ))}
          {users.filter((u) => u.role === 'ARTIST').length === 0 && (
            <p className="text-gray-400 text-center py-6 text-sm">작가(ARTIST) 계정이 없습니다.</p>
          )}
        </div>
      )}

      {selId && detail && (
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">{nameWithNickname(detail.user)} — 지원 이력</p>
          <OvCounts counts={detail.counts} />
          {detail.applications.length === 0 ? (
            <p className="text-gray-400 text-center py-4 text-sm">지원 이력이 없습니다.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.applications.map((a: any) => (
                <div key={a.id} className="p-3 border border-gray-100 rounded-lg flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.exhibition?.title || '(삭제된 공모)'}</p>
                    <p className="text-xs text-gray-500 truncate">{a.gallery?.name} · 지원 {ovDate(a.appliedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <OvBadge status={a.status} />
                    {(a.status === 'ACCEPTED' || a.status === 'REJECTED') && (
                      <span className="text-xs text-gray-400">{ovDate(a.decidedAt)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- 갤러리 게시물(공모+전시) ---
function OvGalleries() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selId, setSelId] = useState<number | null>(null);

  const { data: galleries = [], isLoading } = useQuery<any[]>({
    queryKey: ['ov-galleries', submitted],
    queryFn: () => api.get(`/admin/galleries${submitted ? `?q=${encodeURIComponent(submitted)}` : ''}`).then(r => r.data),
    staleTime: 0,
  });
  const { data: detail } = useQuery<any>({
    queryKey: ['ov-gallery-posts', selId],
    queryFn: () => api.get(`/admin/galleries/${selId}/posts`).then(r => r.data),
    enabled: !!selId,
  });

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); setSelId(null); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="갤러리 이름 검색 (비우면 전체)"
          className="min-w-0 flex-1 p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
        <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">검색</button>
      </form>

      {isLoading ? <div className="h-16 bg-gray-100 animate-pulse rounded-lg" /> : galleries.length === 0 ? (
        <p className="text-gray-400 text-center py-6 text-sm">갤러리가 없습니다.</p>
      ) : (
        <div className="space-y-1.5">
          {galleries.map((g) => (
            <button key={g.id} onClick={() => setSelId(g.id)}
              className={`w-full text-left p-3 border rounded-lg flex items-center justify-between gap-2 transition-colors ${selId === g.id ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-300'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{g.name}</p>
                <p className="text-xs text-gray-500 truncate">{g.owner?.name} · 공모 {g._count?.exhibitions ?? 0} · 전시 {g._count?.shows ?? 0}</p>
              </div>
              <OvBadge status={g.status} kind="post" />
            </button>
          ))}
        </div>
      )}

      {selId && detail && (
        <div className="border-t border-gray-200 pt-4 space-y-4">
          <p className="text-sm font-semibold text-gray-900">{detail.gallery.name} — 게시물</p>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">공모 ({detail.exhibitions.length})</p>
            {detail.exhibitions.length === 0 ? (
              <p className="text-gray-400 text-xs py-2">등록한 공모가 없습니다.</p>
            ) : (
              <div className="space-y-1.5">
                {detail.exhibitions.map((ex: any) => (
                  <div key={ex.id} className="p-3 border border-gray-100 rounded-lg flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{ex.title}</p>
                      <p className="text-xs text-gray-500 truncate">마감 {ovDate(ex.deadline)} · 지원 {ex._count?.applications ?? 0} · 등록 {ovDate(ex.createdAt)}</p>
                    </div>
                    <OvBadge status={ex.status} kind="post" />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">전시 ({detail.shows.length})</p>
            {detail.shows.length === 0 ? (
              <p className="text-gray-400 text-xs py-2">등록한 전시가 없습니다.</p>
            ) : (
              <div className="space-y-1.5">
                {detail.shows.map((s: any) => (
                  <div key={s.id} className="p-3 border border-gray-100 rounded-lg flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{s.title}</p>
                      <p className="text-xs text-gray-500 truncate">{ovDate(s.startDate)} ~ {ovDate(s.endDate)} · 등록 {ovDate(s.createdAt)}</p>
                    </div>
                    <OvBadge status={s.status} kind="post" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-8 md:py-12">
      <button onClick={() => navigate(-1)} className="mb-5 inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft size={16} /> 뒤로가기
      </button>
      <h1 className="mb-6 text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900">{title}</h1>
      {children}
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
