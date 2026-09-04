import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, Edit3, MessageCircle, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { groupBySeries } from '@/lib/artwork';
import ImageLightbox from '@/components/shared/ImageLightbox';
import HomepageView from '@/components/shared/HomepageView';
import FollowButton from '@/components/shared/FollowButton';
import Guestbook from '@/components/shared/Guestbook';
import { useGoBack } from '@/hooks/useGoBack';
import { useCareerColumns } from '@/hooks/useCareerColumns';
import { useAuthStore } from '@/stores/authStore';
import { HOMEPAGE_EDIT_HREF } from '@/lib/myPageMenu';
import type { PortfolioImage, PublicPortfolio } from '@/types';

/**
 * 공개 작가 페이지 — 작가에게는 이게 '내 홈페이지'다.
 *
 * 본문은 `components/shared/HomepageView` 가 그린다. 마이페이지 편집 화면의 미리보기와 **같은 컴포넌트**라
 * 미리보기와 실제가 어긋나지 않는다. 여기서는 페이지 껍데기만 붙인다 — 뒤로가기 / (주인만) 수정 / 라이트박스.
 */
export default function PortfolioPage() {
  const { userId } = useParams();
  // 새 탭·공유 링크로 들어오면 뒤로 갈 기록이 없어 navigate(-1) 이 아무 일도 안 한다
  const goBack = useGoBack('/explore');
  const navigate = useNavigate();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  // 훅은 아래 early return(로딩/에러)보다 반드시 위에서 호출한다
  const careerColumnCount = useCareerColumns();
  const { user: viewer } = useAuthStore();

  /* 갠톡 열기 — 이미 있으면 그 방으로 (서버가 판단). 훅이라 early return 보다 위에 있어야 한다 */
  const openChat = useMutation({
    mutationFn: () => api.post('/chats/direct', { userId: Number(userId) }).then(r => r.data),
    onSuccess: (data: { id: number }) => navigate(`/messages?chat=${data.id}`),
    onError: (e: any) => toast.error(e.response?.data?.error || '대화를 열지 못했습니다.'),
  });

  const { data: portfolio, isLoading, error } = useQuery<PublicPortfolio>({
    queryKey: ['portfolio', userId],
    queryFn: () => api.get(`/portfolio/${userId}`).then(r => r.data),
  });

  // 공개 하이라이트 목록 (작가 프로필 아래에 표시)
  const { data: highlights } = useQuery<any[]>({
    queryKey: ['highlights', userId],
    queryFn: () => userId ? api.get(`/stories/highlights/${userId}`).then(r => r.data) : Promise.resolve([]),
    enabled: !!userId,
  });

  /* HomepageView 안에서 작품 격자를 memo 하므로 이 콜백은 **참조가 안정적이어야** 한다.
     매 렌더 새로 만들면 memo 가 매번 깨져 30장이 다시 그려진다. */
  const openAt = useCallback((img: PortfolioImage) => {
    const ordered = groupBySeries(portfolio?.images ?? [], portfolio?.seriesInfo).flatMap(g => g.images);
    const idx = ordered.findIndex(i => i.id === img.id);
    setLightboxIndex(idx < 0 ? 0 : idx);
    setLightboxOpen(true);
  }, [portfolio?.images, portfolio?.seriesInfo]);

  if (isLoading) return <div className="max-w-7xl mx-auto px-6 md:px-12 py-10"><div className="h-64 bg-gray-100 animate-pulse" /></div>;
  if (error || !portfolio) return <div className="text-center py-16 text-gray-400">포트폴리오를 찾을 수 없습니다.</div>;

  // 라이트박스는 화면에 보이는 순서 그대로 열려야 한다
  const imageUrls = groupBySeries(portfolio.images, portfolio.seriesInfo).flatMap(g => g.images).map(i => i.url);

  // 주인 판정은 **로그인한 사람의 id 와 주소의 userId 비교** 하나뿐이다.
  // 역할(ARTIST)만 보면 다른 작가의 페이지에서도 [수정]이 뜬다.
  const isOwner = !!viewer && String(viewer.id) === String(userId);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* 뒤로가기 + (주인만) 수정 */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <button onClick={goBack} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900 cursor-pointer">
          <ArrowLeft size={16} /> 뒤로가기
        </button>
        {/*
          마이페이지 메뉴 [홈페이지]는 편집 화면이 아니라 여기로 온다 —
          고치기 전에 남에게 어떻게 보이는지 한 번 보게 하려고. 편집 진입점은 이 버튼 하나뿐이다.
          ⚠️ **주인 본인에게만** 보여야 한다. 남의 페이지에서 눌리면 자기 것을 고치게 되어 혼란스럽다.
        */}
        {/* 여긴 남에게 보여줄 홈페이지다 — [수정]은 주인만 쓰는 도구라 **조용해야** 한다.
            테두리 있는 큰 버튼은 페이지의 주인공처럼 보였다. 작고 옅은 글자 링크로. */}
        <div className="flex items-center gap-3">
          {/* [방명록] — 페이지 맨 아래 방명록으로 부드럽게 이동. 있다는 걸 알리고 바로 갈 수 있게(공개라 누구에게나). */}
          <button
            onClick={() => document.getElementById('guestbook')?.scrollIntoView({ behavior: 'smooth' })}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-400 hover:text-gray-900 cursor-pointer"
          >
            <MessageSquare size={13} /> 방명록
          </button>
          {/* [메시지] — 갠톡을 여는 길목(둘러보기 작품 모달과 같은 규칙).
              역할을 가리지 않는다. 주인 본인·비로그인에게는 띄우지 않는다. */}
          {/* [이웃 추가] — 단방향 팔로우. 이 작가의 소식(스토리)을 내 [소식] 피드로 받는다. */}
          {viewer && !isOwner && <FollowButton userId={Number(userId)} />}
          {viewer && !isOwner && (
            <button
              onClick={() => openChat.mutate()}
              disabled={openChat.isPending}
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-400 hover:text-gray-900 disabled:opacity-40 cursor-pointer"
            >
              <MessageCircle size={13} /> 메시지
            </button>
          )}
          {isOwner && (
            <Link
              to={HOMEPAGE_EDIT_HREF}
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-400 hover:text-gray-900"
            >
              <Edit3 size={13} /> 수정
            </Link>
          )}
        </div>
      </div>

      {/* 하이라이트 앨범 (프로필 사진 아래) */}
      {highlights && highlights.length > 0 && (
        <div className="mb-8 pt-6 border-t border-gray-100">
          <div className="flex items-center gap-3 flex-wrap">
            {highlights.map(h => {
              // 커버 이미지: coverStoryId 또는 첫 번째 스토리
              const coverStory = portfolio.images.find(img => img.storyId === h.coverStoryId || (h.storyIds.length > 0 && img.storyId === h.storyIds[0]));
              return (
                <div key={h.id} className="flex flex-col items-center gap-1.5">
                  <button
                    className="h-16 w-16 rounded-full border-2 border-gray-200 overflow-hidden hover:border-gray-400 bg-gray-100"
                    title={h.name}
                  >
                    {coverStory ? (
                      <img src={coverStory.url} alt={h.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-300 to-gray-400 text-white text-xs font-bold">
                        {h.name.slice(0, 2)}
                      </div>
                    )}
                  </button>
                  <span className="text-xs text-gray-600 text-center max-w-16 truncate">{h.name}</span>
                </div>
              );
            })}
          </div>
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
        }}
        onOpenImage={openAt}
        careerColumns={careerColumnCount}
      />

      {/* 방명록 — 공개 홈페이지 하단 */}
      <Guestbook userId={Number(userId)} />

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <ImageLightbox
            images={imageUrls}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
