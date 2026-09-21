import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Edit3, MessageCircle, MessageSquare, QrCode, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { groupBySeries, museumCaption } from '@/lib/artwork';
import { Heart } from 'lucide-react';
import { artistUrl } from '@/lib/handle';
import { resolveHomepageTheme, themeCssVars } from '@/lib/homepageTheme';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import { displayName } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import HomepageView from '@/components/shared/HomepageView';
import FollowButton from '@/components/shared/FollowButton';
import Guestbook from '@/components/shared/Guestbook';
import HighlightRail from '@/components/shared/HighlightRail';
import HighlightViewer from '@/components/shared/HighlightViewer';
import QrModal from '@/components/shared/QrModal';
import { useCareerColumns } from '@/hooks/useCareerColumns';
import { useAuthStore } from '@/stores/authStore';
import { HOMEPAGE_EDIT_HREF } from '@/lib/myPageMenu';
import type { PortfolioImage, PublicPortfolio, StoryHighlight } from '@/types';

/**
 * 공개 작가 페이지 — 작가에게는 이게 '내 홈페이지'다. 주소는 `/@handle` 또는 `/portfolio/:id` (2026-09-16).
 *
 * 본문은 `components/shared/HomepageView` 가 그린다(편집 미리보기와 **같은 컴포넌트**). 여기서는 껍데기만 —
 * 액션 줄(이웃·메시지·공유·QR·방명록·수정) · `?work=` 고유 주소 · 라이트박스 · 방명록.
 *
 * - **비로그인 방문자에게도 이웃·메시지 버튼을 보여준다.** 누르면 로그인으로 보내고, 로그인하면 여기로 돌아온다.
 *   (v1 은 버튼 자체를 숨겨서 뭘 할 수 있는지조차 몰랐다)
 * - `?work=<id>` 는 그 작품을 라이트박스로 연다. 라이트박스에서 넘기면 주소도 따라간다(replace) —
 *   그 상태에서 주소를 복사해 보내면 서버 SEO 메타가 그 작품을 미리보기로 만든다.
 * - 테마 배경은 페이지 전체(방명록까지)에 깐다 — 본문만 물들이면 두 페이지를 붙여 놓은 것처럼 보인다.
 */
export default function PortfolioPage({ artistId }: { artistId?: number } = {}) {
  const { userId } = useParams();
  // 들어오는 길이 둘이다: `/portfolio/:userId`(숫자) 와 `/@handle`(App.tsx 의 `HandleRoute` 가 주인을 알아내 id 로 넘긴다).
  // 핸들을 여기서 다시 풀지 않는다 — 작가·갤러리가 이름 공간을 공유하므로 판정은 한 곳(HandleRoute)에서만.
  const key = artistId != null ? String(artistId) : String(userId ?? '');
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [openHighlight, setOpenHighlight] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // 훅은 아래 early return(로딩/에러)보다 반드시 위에서 호출한다
  const careerColumnCount = useCareerColumns();
  const { user: viewer, isAuthenticated } = useAuthStore();

  const { data: portfolio, isLoading, error } = useQuery<PublicPortfolio>({
    queryKey: ['portfolio', key],
    queryFn: () => api.get(`/portfolio/${encodeURIComponent(key)}`).then(r => r.data),
    enabled: !!key,
  });
  const ownerId = portfolio?.user.id;

  /* 갠톡 열기 — 이미 있으면 그 방으로 (서버가 판단). 훅이라 early return 보다 위에 있어야 한다 */
  const openChat = useMutation({
    mutationFn: () => api.post('/chats/direct', { userId: ownerId }).then(r => r.data),
    onSuccess: (data: { id: number }) => navigate(`/messages?chat=${data.id}`),
    onError: (e: any) => toast.error(e.response?.data?.error || '대화를 열지 못했습니다.'),
  });

  // 공개 하이라이트 목록 (작가 프로필 아래에 표시)
  const { data: highlights } = useQuery<StoryHighlight[]>({
    queryKey: ['highlights', ownerId],
    queryFn: () => api.get(`/stories/highlights/${ownerId}`).then(r => r.data),
    enabled: !!ownerId,
  });

  // 화면에 보이는 순서(시리즈별) — 라이트박스·?work= 가 이 순서를 쓴다
  const ordered = useMemo(
    () => groupBySeries(portfolio?.images ?? [], portfolio?.seriesInfo).flatMap(g => g.images),
    [portfolio?.images, portfolio?.seriesInfo],
  );

  /* HomepageView 안에서 작품 격자를 memo 하므로 이 콜백은 **참조가 안정적이어야** 한다. */
  const openAt = useCallback((img: PortfolioImage) => {
    const idx = ordered.findIndex(i => i.id === img.id);
    setLightboxIndex(idx < 0 ? 0 : idx);
    setLightboxOpen(true);
  }, [ordered]);

  // `?work=` 로 들어오면 그 작품을 바로 연다 — 공유 링크의 약속
  const workParam = searchParams.get('work');
  useEffect(() => {
    if (!portfolio || !workParam) return;
    const idx = ordered.findIndex(i => String(i.id) === workParam);
    if (idx >= 0) { setLightboxIndex(idx); setLightboxOpen(true); }
    // 포트폴리오가 로드된 시점에 한 번만. 이후 주소 변화는 라이트박스가 만든 것이라 다시 열 필요가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio?.id]);

  // 함수형 갱신 — `searchParams` 를 의존성에 넣으면 갱신할 때마다 콜백이 새로 만들어져 라이트박스 effect 가 다시 돈다
  // ⚠️ 정식 주소(`/@handle`)로 갈아끼우는 effect 와 경합한다 — `setSearchParams` 는 **현재 pathname** 에 쿼리를 얹으므로
  //    숫자 주소에서 라이트박스가 열리면 방금 바꾼 `/@handle` 을 다시 `/portfolio/:id` 로 되돌렸다(2026-09-19 실측 replaceState 3회).
  //    그래서 pathname 을 정식 주소로 함께 넘긴다(ref — 의존성에 넣으면 콜백이 매번 새로 만들어져 라이트박스 effect 가 다시 돈다).
  const canonicalRef = useRef<string | null>(null);
  const syncWorkParam = useCallback((idx: number | null) => {
    const next = new URLSearchParams(window.location.search);
    if (idx === null || !ordered[idx]) next.delete('work');
    else next.set('work', String(ordered[idx]!.id));
    const search = next.toString();
    navigate({ pathname: canonicalRef.current ?? window.location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [ordered, navigate]);

  const theme = useMemo(() => resolveHomepageTheme(portfolio?.designConfig), [portfolio?.designConfig]);

  /*
    정식 주소로 바꿔 준다 (2026-09-16) — 숫자 주소 `/portfolio/526` 으로 들어왔는데 이 작가에게 핸들이 있으면
    `/@handle` 로 갈아끼운다(`replace` 라 뒤로가기 기록을 더럽히지 않는다).
    ⚠️ 앱 안의 링크를 전부 고치는 것보다 이게 확실하다 — 작가 id 를 들고 있는 곳이 목록·피드·방명록·알림처럼 여럿이고,
       그 모든 응답에 핸들을 실어 나르게 만들면 한 곳만 빠져도 조용히 숫자 주소가 남는다.
    ⚠️ `?work=` 같은 쿼리는 그대로 옮긴다 — 안 그러면 공유 링크로 들어온 사람이 작품을 잃는다.
  */
  const canonical = portfolio?.user.handle ? `/@${portfolio.user.handle}` : null;
  canonicalRef.current = canonical;
  useEffect(() => {
    if (!canonical || location.pathname === canonical) return;
    navigate({ pathname: canonical, search: location.search }, { replace: true });
  }, [canonical, location.pathname, location.search, navigate]);

  /* ⚠️ 아래 훅들은 반드시 early return **위**에 있어야 한다. 2026-09-19 배포에서 로딩 분기 아래에 두었다가
     포트폴리오가 도착하는 순간 훅 개수가 늘어 React #310 으로 작가 홈페이지 전체가 '화면을 불러오지 못했어요'가 됐다(2026-09-21 수정). */
  const captionTexts = useMemo(() => ordered.map((i) => {
    const c = museumCaption(i);
    return c ? [c.head, c.medium, c.size].filter(Boolean).join(' / ') : null;
  }), [ordered]);
  /* 라이트박스 좋아요(2026-09-19) — 같은 작품을 [작가] 탭에서 열면 눌리는데 홈페이지에선 못 눌렀다.
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
  const renderLike = useCallback((idx: number) => {
    const img = ordered[idx];
    if (!img || !img.showInExplore) return null;
    const st = likeState[img.id] ?? { liked: false, count: 0 };
    const onClick = () => {
      if (!isAuthenticated) { setPostLoginRedirect(window.location.pathname + window.location.search); navigate('/login'); return; }
      likeMutation.mutate(img.id);
    };
    return (
      <button onClick={onClick} aria-label={st.liked ? '좋아요 취소' : '좋아요'} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/25">
        <Heart size={16} className={st.liked ? 'fill-accent text-accent' : ''} />
        {st.count > 0 && <span>{st.count}</span>}
      </button>
    );
  }, [ordered, likeState, isAuthenticated, navigate, likeMutation]);
  if (isLoading) return <div className="max-w-7xl mx-auto px-6 md:px-12 py-10"><div className="h-64 bg-gray-100 animate-pulse" /></div>;
  if (error || !portfolio) return <div className="text-center py-16 text-gray-400">포트폴리오를 찾을 수 없습니다.</div>;


  const imageUrls = ordered.map(i => i.url);
  const artistName = displayName(portfolio.user);
  // 주인 판정은 **로그인한 사람의 id 와 페이지 주인의 id 비교** 하나뿐이다(핸들 주소라 URL 의 숫자를 못 믿는다).
  const isOwner = !!viewer && viewer.id === portfolio.user.id;
  const pageUrl = artistUrl(portfolio.user);

  const requireLogin = () => {
    setPostLoginRedirect(location.pathname + location.search);
    toast('로그인이 필요합니다.');
    navigate('/login');
  };
  const share = async () => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    try {
      if (nav?.share) { await nav.share({ title: `${artistName} — ArtLink`, url: pageUrl }); return; }
      await nav?.clipboard?.writeText(pageUrl);
      toast.success('링크를 복사했습니다.');
    } catch { /* 사용자가 공유 시트를 닫았거나 클립보드 권한이 없다 — 조용히 */ }
  };

  const actionClass = 'inline-flex min-h-[44px] items-center gap-1.5 text-sm hover:underline underline-offset-4 cursor-pointer disabled:opacity-40';
  const actions = (
    <>
      {!isOwner && portfolio.user.id && <FollowButton userId={portfolio.user.id} variant="text" />}
      {!isOwner && (
        <button onClick={() => (isAuthenticated ? openChat.mutate() : requireLogin())} disabled={openChat.isPending} className={actionClass}>
          <MessageCircle size={14} /> 메시지
        </button>
      )}
      <button onClick={share} className={actionClass}><Share2 size={14} /> 공유</button>
      <button onClick={() => setQrOpen(true)} className={actionClass}><QrCode size={14} /> QR</button>
      <button onClick={() => document.getElementById('guestbook')?.scrollIntoView({ behavior: 'smooth' })} className={actionClass}>
        <MessageSquare size={14} /> 방명록
      </button>
      {/* 주인 본인에게만 — 남에게 보여줄 홈페이지라 도구는 조용해야 한다 */}
      {isOwner && <Link to={HOMEPAGE_EDIT_HREF} className={actionClass}><Edit3 size={14} /> 수정</Link>}
    </>
  );

  return (
    <div style={themeCssVars(theme)} className="min-h-[calc(100vh-4rem)]">   {/* 어두운 테마에서 아래쪽 흰 띠가 남았다 — Layout 의 main 이 flex-1 이라도 이 div 가 늘어나야 한다(2026-09-19) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12 pt-8 pb-14 md:pt-12 md:pb-20">
        {/* 하이라이트 앨범 — ArtStory 와 같은 컴포넌트를 쓴다(따로 만들면 어긋난다) */}
        {highlights && highlights.length > 0 && (
          <div className="mb-8">
            <HighlightRail highlights={highlights} onOpen={(h) => setOpenHighlight(h.id)} />
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
          }}
          onOpenImage={openAt}
          careerColumns={careerColumnCount}
          actions={actions}
        />

        {/* 방명록 — 공개 홈페이지 하단. 테마 색을 물려받는다 */}
        <Guestbook userId={portfolio.user.id} />
      </div>

      {openHighlight != null && (
        <HighlightViewer highlightId={openHighlight} onClose={() => setOpenHighlight(null)} />
      )}
      {qrOpen && <QrModal url={pageUrl} title={artistName} onClose={() => setQrOpen(false)} />}

      {/* Lightbox — 넘기면 ?work= 도 따라간다 */}
      <AnimatePresence>
        {lightboxOpen && (
          <ImageLightbox
            images={imageUrls}
            captions={captionTexts}
            renderExtra={renderLike}
            initialIndex={lightboxIndex}
            onIndexChange={(i) => syncWorkParam(i)}
            onClose={() => { setLightboxOpen(false); syncWorkParam(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
