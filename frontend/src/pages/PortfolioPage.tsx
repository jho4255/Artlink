import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Edit3, QrCode, Share2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { artworkTitle, groupBySeries, hasTitle } from '@/lib/artwork';
import { Heart } from 'lucide-react';
import { artistUrl } from '@/lib/handle';
import { resolveHomepageTheme, showNowFrom, themeCssVars, themeVarStyle } from '@/lib/homepageTheme';
import { markSiteNoticeSeen, siteNoticeSeen } from '@/lib/homepageSite';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import { shareLink } from '@/lib/shareLink';
import { displayName } from '@/lib/utils';
import type { ViewerMode } from '@/lib/wallView';
import { saveViewerMode } from '@/lib/wallView';
import ArtworkViewer from '@/components/shared/ArtworkViewer';
import HomepageView from '@/components/shared/HomepageView';
import FollowButton from '@/components/shared/FollowButton';
import Guestbook from '@/components/shared/Guestbook';
import QrModal from '@/components/shared/QrModal';
import SiteHeader from '@/components/homepage/SiteHeader';
import SiteFooter from '@/components/homepage/SiteFooter';
import NewsTab from '@/components/homepage/NewsTab';
import WorkSheet from '@/components/homepage/WorkSheet';
import InquirySheet, { type InquiryWork } from '@/components/homepage/InquirySheet';
import { LinkAction, OwnerLink, TabActions } from '@/components/homepage/Actions';
import { useCareerColumns } from '@/hooks/useCareerColumns';
import { useAuthStore } from '@/stores/authStore';
import { editHref, editSectionForTab } from '@/lib/homepageEdit';
import { PDF_HINT_MIN_WORKS, dismissPdfHint, pdfHintDismissed } from '@/lib/portfolioMaker';
import type { PortfolioImage, PublicPortfolio } from '@/types';

/**
 * 공개 작가 페이지 — 작가에게는 이게 '내 홈페이지'다. 주소는 `/@handle` 또는 `/portfolio/:id` (2026-09-16).
 *
 * 2026-11-14 개편(CLAUDE.md 규칙 82) — '내 사이트' 모드:
 *  · 머리는 ArtLink 상단바가 아니라 **작가 이름**(SiteHeader). 탭 줄은 PC·휴대폰 모두 표지 아래 하나 — 누르면 그 탭 내용으로 내려간다(2026-11-15).
 *    맨 오른쪽 작은 ArtLink 글자 · 주인에게 [수정]. 꼬리말도 작가의 것(SiteFooter — Made with ArtLink).
 *  · 첫 화면 = **표지**(대표작 + 이름 + 버튼 줄 + '전시 중' 띠) — 본문은 `components/shared/HomepageView`(편집 미리보기와 같은 컴포넌트).
 *  · 버튼 한 벌(components/homepage/Actions): [문의하기] 하나만 채움 · 이웃 추가 · 공유 · QR 은 글자 링크. 예전 [메시지]는 [문의하기]로 합쳤다.
 *  · [문의하기] — 회원은 ArtTalk(갠톡), 비회원은 작가가 켰으면 이름·연락처, 아니면 로그인으로(InquirySheet).
 *  · 작품을 누르면 **작품 페이지**(WorkSheet, 주소 `?work=<id>` 그대로) — 정보·가격·설명·[작품 문의하기]·같은 시리즈.
 *    검은 작품 창(ArtworkViewer)은 거기서 [크게 보기].
 *  · [소식] 탭 — 이 작가가 올린 ArtStory(NewsTab). 예전엔 하이라이트만 이름 위에 따로 떠 있었다.
 *
 * - **비로그인 방문자에게도 이웃·문의 버튼을 보여준다.** 누르면 로그인으로 보내고, 로그인하면 여기로 돌아온다.
 * - `?work=<id>` — 들어오면 그 작품 페이지가 열린다(공유 링크의 약속). 목록에서 열면 기록을 하나 쌓는다(push) — 뒤로가기 = 작품 목록.
 *   작품 사이를 넘길 땐 replace. 서버 SEO 메타가 그 작품을 미리보기로 만든다.
 * - 테마 배경은 페이지 전체(방명록·꼬리말까지)에 깐다 — 본문만 물들이면 두 페이지를 붙여 놓은 것처럼 보인다.
 */
export default function PortfolioPage({ artistId }: { artistId?: number } = {}) {
  const { userId } = useParams();
  // 들어오는 길이 둘이다: `/portfolio/:userId`(숫자) 와 `/@handle`(App.tsx 의 `HandleRoute` 가 주인을 알아내 id 로 넘긴다).
  // 핸들을 여기서 다시 풀지 않는다 — 작가·갤러리가 이름 공간을 공유하므로 판정은 한 곳(HandleRoute)에서만.
  const key = artistId != null ? String(artistId) : String(userId ?? '');
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  /** 크게 보기(검은 작품 창) — 작품 페이지 위에 뜬다 */
  const [zoom, setZoom] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [inquiry, setInquiry] = useState<{ work: InquiryWork | null } | null>(null);
  /*
    홈페이지 편집을 **저장한 직후**에만 한 번 — "이 내용으로 포트폴리오 PDF 도 만들 수 있어요" (2026-10-03, 사용자 결정).
    PDF 만들기 기능을 알려 주는 곳이 편집 화면 [파일] 묶음의 링크 한 줄뿐이라 있는 줄 모르는 작가가 많았다(작품 있는 47명 중 써 본 흔적 1명).
    평소 방문에는 띄우지 않는다 — 공개 홈페이지의 주인 화면은 조용해야 한다(2026-10-02 결정). 닫거나 PDF 를 한 번 저장하면 다시 안 뜬다.
    처음 들어올 때의 값을 state 로 들고 있는다 — 탭을 바꾸면 주소를 갈아끼우며(replace) location.state 가 사라진다.
  */
  const [pdfHint, setPdfHint] = useState(() => !!(location.state as { savedHomepage?: boolean } | null)?.savedHomepage);
  /** 개편 뒤 주인이 처음 왔을 때 한 번 — '홈페이지가 새 모양으로 바뀌었어요 · [꾸미기]' (닫으면 이 브라우저에서 다시 안 뜬다) */
  const [noticeClosed, setNoticeClosed] = useState(false);
  // 훅은 아래 early return(로딩/에러)보다 반드시 위에서 호출한다
  const careerColumnCount = useCareerColumns();
  const { user: viewer, isAuthenticated } = useAuthStore();

  const { data: portfolio, isLoading, error } = useQuery<PublicPortfolio>({
    queryKey: ['portfolio', key],
    queryFn: () => api.get(`/portfolio/${encodeURIComponent(key)}`).then(r => r.data),
    enabled: !!key,
  });
  const ownerId = portfolio?.user.id;

  // 방명록 글 수 — 탭 이름 옆에 적는다. `Guestbook` 과 **같은 쿼리 키**라 한 번만 받는다
  const { data: guestbookData } = useQuery<{ entries: unknown[] }>({
    queryKey: ['guestbook', ownerId],
    queryFn: () => api.get(`/guestbook/${ownerId}`).then(r => r.data),
    enabled: !!ownerId,
  });

  // 화면에 보이는 순서(시리즈별) — 작품 페이지·크게 보기·?work= 가 이 순서를 쓴다
  const ordered = useMemo(
    () => groupBySeries(portfolio?.images ?? [], portfolio?.seriesInfo).flatMap(g => g.images),
    [portfolio?.images, portfolio?.seriesInfo],
  );

  /*
    정식 주소로 바꿔 준다 (2026-09-16) — 숫자 주소 `/portfolio/526` 으로 들어왔는데 이 작가에게 핸들이 있으면
    `/@handle` 로 갈아끼운다(`replace` 라 뒤로가기 기록을 더럽히지 않는다). `?work=`·`?tab=` 같은 쿼리는 그대로 옮긴다.
  */
  const canonical = portfolio?.user.handle ? `/@${portfolio.user.handle}` : null;
  const canonicalRef = useRef<string | null>(null);
  canonicalRef.current = canonical;
  useEffect(() => {
    if (!canonical || location.pathname === canonical) return;
    navigate({ pathname: canonical, search: location.search }, { replace: true, state: location.state });
  }, [canonical, location.pathname, location.search, location.state, navigate]);

  /*
    `?work=` — 작품 페이지. 목록에서 열 때 push(뒤로가기 = 목록), 넘길 때 replace.
    ⚠️ pathname 은 정식 주소로(canonicalRef) — 숫자 주소에서 열면 방금 바꾼 `/@handle` 을 되돌린다(2026-09-19 실측 replaceState 3회).
  */
  const workParam = searchParams.get('work');
  const workIndex = workParam ? ordered.findIndex(i => String(i.id) === workParam) : -1;
  const setWorkParam = useCallback((id: number | null, mode: 'push' | 'replace') => {
    const next = new URLSearchParams(window.location.search);
    if (id == null) next.delete('work'); else next.set('work', String(id));
    const search = next.toString();
    const fromList = mode === 'push' ? true : !!(window.history.state?.usr as { workFromList?: boolean } | null)?.workFromList;
    navigate(
      { pathname: canonicalRef.current ?? window.location.pathname, search: search ? `?${search}` : '' },
      { replace: mode === 'replace', state: id != null && fromList ? { workFromList: true } : null },
    );
  }, [navigate]);

  /* HomepageView 안에서 작품 격자를 memo 하므로 이 콜백은 **참조가 안정적이어야** 한다. */
  const openAt = useCallback((img: PortfolioImage) => setWorkParam(img.id, 'push'), [setWorkParam]);
  const closeWork = useCallback(() => {
    // 목록에서 열었으면 뒤로(목록 자리 그대로) — 공유 링크로 바로 들어왔으면 기록이 없으니 주소에서 뗀다
    if ((window.history.state?.usr as { workFromList?: boolean } | null)?.workFromList) navigate(-1);
    else setWorkParam(null, 'replace');
  }, [navigate, setWorkParam]);

  const theme = useMemo(() => resolveHomepageTheme(portfolio?.designConfig), [portfolio?.designConfig]);
  const portalVars = useMemo(() => themeVarStyle(theme), [theme]);

  /*
    탭(2026-09-25) — `?tab=news|note|cv|file|guestbook`, 첫 탭(대개 작품)은 쿼리 없음. 주소에 두는 이유: 방명록 알림이
    `?tab=guestbook` 으로 바로 들어오고, 작가가 "제 포트폴리오 보세요" 하며 `?tab=file` 링크를 보낼 수 있다.
    replace — 탭을 누를 때마다 뒤로가기 기록이 쌓이면 [뒤로]가 탭을 거꾸로 훑는다.
  */
  const tabParam = searchParams.get('tab');
  const onTabChange = useCallback((_id: string, param: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (param) next.set('tab', param); else next.delete('tab');
    const search = next.toString();
    navigate({ pathname: canonicalRef.current ?? window.location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [navigate]);

  /* ⚠️ 아래 훅들은 반드시 early return **위**에 있어야 한다. 2026-09-19 배포에서 로딩 분기 아래에 두었다가
     포트폴리오가 도착하는 순간 훅 개수가 늘어 React #310 으로 작가 홈페이지 전체가 '화면을 불러오지 못했어요'가 됐다(2026-09-21 수정). */
  /* 작품 좋아요(2026-09-19) — 같은 작품을 [작가] 탭에서 열면 눌리는데 홈페이지에선 못 눌렀다.
     공개(showInExplore) 작품만 서버가 받는다. 상태는 응답의 likedImageIds + _count.likes 로 시작해 로컬로 갱신한다. */
  const [likeState, setLikeState] = useState<Record<number, { liked: boolean; count: number }>>({});
  useEffect(() => {
    if (!portfolio) return;
    const liked = new Set<number>(((portfolio as any).likedImageIds ?? []) as number[]);
    const next: Record<number, { liked: boolean; count: number }> = {};
    for (const img of portfolio.images) next[img.id] = { liked: liked.has(img.id), count: (img as any)._count?.likes ?? 0 };
    setLikeState(next);
  }, [portfolio]);
  const likeMutation = useMutation({
    mutationFn: (imageId: number) => api.post(`/explore/${imageId}/like`).then((r) => r.data as { liked: boolean; likeCount: number }),
    onSuccess: (data, imageId) => setLikeState((prev) => ({ ...prev, [imageId]: { liked: data.liked, count: data.likeCount } })),
    onError: (e: any) => toast.error(e.response?.data?.error || '좋아요에 실패했습니다.'),
  });
  const toggleLike = useCallback((imageId: number) => {
    if (!isAuthenticated) { setPostLoginRedirect(window.location.pathname + window.location.search); navigate('/login'); return; }
    likeMutation.mutate(imageId);
  }, [isAuthenticated, navigate, likeMutation]);
  const renderLike = useCallback((idx: number) => {
    const img = ordered[idx];
    if (!img || !img.showInExplore) return null;
    const st = likeState[img.id] ?? { liked: false, count: 0 };
    return (
      <button type="button" onClick={() => toggleLike(img.id)} aria-label={st.liked ? '좋아요 취소' : '좋아요'} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-sm text-white backdrop-blur hover:bg-white/25">
        <Heart size={16} className={st.liked ? 'fill-accent text-accent' : ''} />
        {st.count > 0 && <span>{st.count}</span>}
      </button>
    );
  }, [ordered, likeState, toggleLike]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <SiteHeader />
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-10"><div className="h-64 bg-gray-100 animate-pulse" /></div>
      </div>
    );
  }
  if (error || !portfolio) {
    return (
      <div className="min-h-screen bg-white">
        <SiteHeader />
        <div className="text-center py-16 text-gray-400">포트폴리오를 찾을 수 없습니다.</div>
      </div>
    );
  }

  const artistName = displayName(portfolio.user);
  // 주인 판정은 **로그인한 사람의 id 와 페이지 주인의 id 비교** 하나뿐이다(핸들 주소라 URL 의 숫자를 못 믿는다).
  const isOwner = !!viewer && viewer.id === portfolio.user.id;
  const pageUrl = artistUrl(portfolio.user);
  const homePath = canonical ?? `/portfolio/${portfolio.user.id}`;

  const share = async () => {
    if ((await shareLink(`${artistName} — ArtLink`, pageUrl)) === 'copied') toast.success('링크를 복사했습니다.');
  };

  // 탭 — 표지 아래 탭 막대(HomepageView). 소식·방명록 수는 여기서 넘긴다
  const news = { storyCount: portfolio.storyCount ?? 0, highlightCount: portfolio.highlightCount ?? 0 };
  const guestbookCount = guestbookData?.entries.length;

  const openInquiry = (work: InquiryWork | null) => setInquiry({ work });
  const canInquire = !isOwner;

  // 버튼 한 벌 — [문의하기] 하나만 채움, 나머지는 글자 링크(components/homepage/Actions)
  /* 버튼 묶음 — 탭 줄 오른쪽(2026-11-15 사용자: "내리면서도 볼 수 있게" · "문의하기만 검정색으로 띡 — 통일성 있되 강조"). components/homepage/Actions TabActions */
  const actions = (
    <TabActions onInquiry={canInquire ? () => openInquiry(null) : null}>
      {!isOwner && portfolio.user.id && <FollowButton userId={portfolio.user.id} variant="text" className="whitespace-nowrap text-[var(--hp-sub)] hover:text-[var(--hp-ink)]" />}
      <LinkAction icon={Share2} onClick={share}>공유</LinkAction>
      <LinkAction icon={QrCode} onClick={() => setQrOpen(true)}>QR</LinkAction>
    </TabActions>
  );
  /* 주인 본인에게만 — 사이트 머리 오른쪽(2026-11-14). **보던 탭의 묶음**으로 연다 — 약력 탭에서 누르면 편집 화면의 [약력] 이 열린다. */
  const ownerAction = isOwner ? (
    <OwnerLink to={editHref(editSectionForTab(tabParam))} testId="homepage-owner-action"><Edit3 size={14} /> 수정</OwnerLink>
  ) : null;

  const showSiteNotice = isOwner && !pdfHint && !noticeClosed && !siteNoticeSeen(portfolio.user.id);
  const closeSiteNotice = () => { markSiteNoticeSeen(portfolio.user.id); setNoticeClosed(true); };

  const work = workIndex >= 0 ? ordered[workIndex] : undefined;
  const likeFor = (img?: PortfolioImage) => {
    if (!img || !img.showInExplore) return null;
    const st = likeState[img.id] ?? { liked: false, count: 0 };
    return { liked: st.liked, count: st.count, onToggle: () => toggleLike(img.id) };
  };

  return (
    <div style={themeCssVars(theme)} className="flex min-h-screen flex-col">   {/* 어두운 테마에서 아래쪽 흰 띠가 남지 않게 페이지 전체를 칠한다 */}
      <SiteHeader
        title={artistName}
        titleTo={homePath}
        ownerAction={ownerAction}
      />
      <main className="max-w-7xl w-full mx-auto flex-1 px-6 md:px-12 pt-8 pb-14 md:pt-12 md:pb-20">
        {isOwner && pdfHint && portfolio.images.length >= PDF_HINT_MIN_WORKS && !pdfHintDismissed(portfolio.user.id) && (
          <div
            data-testid="pdf-hint"
            className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-2.5 text-sm"
            style={{ borderColor: 'color-mix(in srgb, var(--hp-ink) 25%, transparent)', color: 'var(--hp-ink)' }}
          >
            <span className="min-w-0 flex-1 break-keep">홈페이지를 저장했어요. 이 내용으로 갤러리·공모에 낼 <b className="font-semibold">포트폴리오 PDF</b> 도 만들 수 있어요.</span>
            <Link to="/mypage?tab=portfolio" onClick={() => dismissPdfHint(portfolio.user.id)} className="inline-flex min-h-[40px] shrink-0 items-center font-medium underline underline-offset-4">
              PDF 만들기
            </Link>
            <button
              type="button"
              aria-label="안내 닫기"
              onClick={() => { dismissPdfHint(portfolio.user.id); setPdfHint(false); }}
              className="-mr-2 grid h-10 w-10 shrink-0 place-items-center opacity-60 hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {showSiteNotice && (
          <div
            data-testid="site-notice"
            className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-2.5 text-sm"
            style={{ borderColor: 'color-mix(in srgb, var(--hp-ink) 25%, transparent)', color: 'var(--hp-ink)' }}
          >
            <span className="min-w-0 flex-1 break-keep">홈페이지가 새 모양으로 바뀌었어요.</span>
            <Link to={editHref('style')} onClick={closeSiteNotice} className="inline-flex min-h-[40px] shrink-0 items-center font-medium underline underline-offset-4">꾸미기</Link>
            <button type="button" aria-label="안내 닫기" onClick={closeSiteNotice} className="-mr-2 grid h-10 w-10 shrink-0 place-items-center opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        )}

        <HomepageView
          data={{
            user: portfolio.user,
            tagline: portfolio.tagline,
            statement: portfolio.statement,
            biography: portfolio.biography,
            career: portfolio.career,
            portfolioFileUrl: portfolio.portfolioFileUrl,
            seriesInfo: portfolio.seriesInfo,
            images: portfolio.images,
            designConfig: portfolio.designConfig,
            showAvatar: portfolio.showAvatar === true,
            nowShowing: showNowFrom(portfolio.designConfig) ? portfolio.nowShowing ?? null : null,
          }}
          onOpenImage={openAt}
          careerColumns={careerColumnCount}
          actions={actions}
          // 아직 아무것도 없는 홈페이지 — 방문자에겐 '준비 중', 주인에겐 무엇을 하면 되는지(작품 올리기)
          emptyText={isOwner ? '작품 사진을 올리면 홈페이지가 바로 생깁니다.' : '아직 준비 중인 홈페이지입니다.'}
          emptyAction={isOwner ? (
            <Link
              to={editHref('works')}
              className="inline-flex min-h-[44px] items-center gap-2 px-5 text-sm font-medium"
              style={{ backgroundColor: 'var(--hp-ink)', color: 'var(--hp-bg)' }}
            >
              <Upload size={15} /> 작품 올리기
            </Link>
          ) : undefined}
          tab={tabParam}
          onTabChange={onTabChange}
          // [소식] — 이 작가가 올린 ArtStory. 탭을 그릴지는 서버가 센 수로(보는 사람 기준)
          news={{ ...news, content: <NewsTab userId={portfolio.user.id} isOwner={isOwner} /> }}
          // 방명록 — [방명록] 탭. 테마 색을 물려받는다
          guestbook={{ count: guestbookCount, content: <Guestbook userId={portfolio.user.id} bare /> }}
        />
      </main>
      <SiteFooter
        name={artistName}
        instagramUrl={portfolio.user.instagramUrl}
        onInquiry={canInquire ? () => openInquiry(null) : undefined}
      />

      {qrOpen && <QrModal url={pageUrl} title={artistName} onClose={() => setQrOpen(false)} />}

      {/* 작품 페이지 — `?work=` 가 있고 그 작품이 있으면(지운 작품 링크면 목록 그대로) */}
      {work && (
        <WorkSheet
          works={ordered}
          index={workIndex}
          artistName={artistName}
          themeVars={portalVars}
          onIndex={(i) => { const w = ordered[i]; if (w) setWorkParam(w.id, 'replace'); }}
          onClose={closeWork}
          onZoom={(mode: ViewerMode) => { saveViewerMode(mode); setZoom(workIndex); }}
          onInquiry={canInquire ? () => openInquiry({ id: work.id, title: hasTitle(work) ? artworkTitle(work) : null, url: work.url }) : null}
          like={likeFor(work)}
          onShare={async () => {
            const title = hasTitle(work) ? `${artworkTitle(work)} — ${artistName}` : artistName;
            if ((await shareLink(title, artistUrl(portfolio.user, work.id))) === 'copied') toast.success('링크를 복사했습니다.');
          }}
          ownerEditHref={isOwner ? editHref('works', { info: true, work: work.id }) : null}
          childOpen={zoom !== null || inquiry !== null || qrOpen}
        />
      )}

      {/* 크게 보기 — 검은 작품 창. 넘기면 아래 작품 페이지도 따라간다(?work= replace). [사진 | 벽에 걸어 보기] 는 그 안에서(규칙 74) */}
      <AnimatePresence>
        {zoom !== null && (
          <ArtworkViewer
            works={ordered}
            initialIndex={zoom}
            artistName={artistName}
            renderLike={renderLike}
            shareUrl={(i) => artistUrl(portfolio.user, ordered[i]?.id)}
            onIndexChange={(i) => { const w = ordered[i]; if (w) setWorkParam(w.id, 'replace'); }}
            onClose={() => setZoom(null)}
          />
        )}
      </AnimatePresence>

      {inquiry && (
        <InquirySheet
          target={{ ownerId: portfolio.user.id, name: artistName, guestEnabled: portfolio.guestInquiry === true }}
          work={inquiry.work}
          themeVars={portalVars}
          onClose={() => setInquiry(null)}
        />
      )}
    </div>
  );
}
