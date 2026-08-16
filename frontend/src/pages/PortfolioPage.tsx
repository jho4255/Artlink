import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, User, FileText, Calendar, Instagram } from 'lucide-react';
import api from '@/lib/axios';
import { displayName, safeHttpUrl, instagramHandle } from '@/lib/utils';
import {
  artworkTitle, captionInline, careerLineText, groupBySeries, hasTitle,
  isCareerEmpty, normalizeCareer, statusBadge,
} from '@/lib/artwork';
import { reflowProse } from '@/lib/prose';
import ImageLightbox from '@/components/shared/ImageLightbox';
import { useGoBack } from '@/hooks/useGoBack';
import type { PortfolioImage, PublicPortfolio, CareerKey } from '@/types';

const CAREER_LABELS: { key: CareerKey; label: string }[] = [
  { key: 'education', label: '학력' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어' },
  { key: 'award', label: '수상 및 선정' },
];

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[13px] font-semibold tracking-[0.14em] text-gray-900 border-l-2 border-[#c4302b] pl-2.5 mb-3">{children}</h3>
);

export default function PortfolioPage() {
  const { userId } = useParams();
  // 새 탭·공유 링크로 들어오면 뒤로 갈 기록이 없어 navigate(-1) 이 아무 일도 안 한다
  const goBack = useGoBack('/explore');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const { data: portfolio, isLoading, error } = useQuery<PublicPortfolio>({
    queryKey: ['portfolio', userId],
    queryFn: () => api.get(`/portfolio/${userId}`).then(r => r.data),
  });

  if (isLoading) return <div className="max-w-7xl mx-auto px-6 md:px-12 py-10"><div className="h-64 bg-gray-100 animate-pulse" /></div>;
  if (error || !portfolio) return <div className="text-center py-16 text-gray-400">포트폴리오를 찾을 수 없습니다.</div>;

  // 라이트박스는 화면에 보이는 순서 그대로 열려야 한다
  const groups = groupBySeries(portfolio.images, portfolio.seriesInfo);
  const ordered = groups.flatMap(g => g.images);
  const imageUrls = ordered.map(i => i.url);
  const openAt = (img: PortfolioImage) => {
    const idx = ordered.findIndex(i => i.id === img.id);
    setLightboxIndex(idx < 0 ? 0 : idx);
    setLightboxOpen(true);
  };

  const career = normalizeCareer(portfolio.career);
  const careerEmpty = isCareerEmpty(portfolio.career);
  const totalWorks = groups.reduce((n, g) => n + g.images.length, 0);

  /**
   * 작품 카드 — 정사각 칸 안에 원본 비율 그대로(object-contain).
   *
   * 예전엔 masonry(columns) 라 폭만 맞고 높이가 제각각이어서 **줄이 어긋났다**.
   * 칸을 정사각으로 고정해 행렬을 맞춘다.
   *
   * ⚠️ 칸 배경은 흰색이다. 회색 타일을 깔면 작품마다 회색 여백이 눈에 띄어
   *    작품보다 타일이 먼저 읽힌다 — 칸은 정렬을 위한 보이지 않는 격자여야 한다.
   * ⚠️ contain 이라 비율은 그대로다. 자르지도 늘리지도 않는다(CLAUDE.md 18번).
   */
  const ArtworkCard = ({ img, index }: { img: PortfolioImage; index: number }) => {
    const st = statusBadge(img);
    const meta = captionInline(img);
    const titled = hasTitle(img);
    /* 제목 없는 작품이 대부분(372점 중 9점만 제목 있음)이라 alt 에 '무제' 를 그대로 쓰면
       스크린리더가 그것만 반복해 읽는다. 없을 땐 순번으로 구별해 준다. */
    const alt = titled ? artworkTitle(img) : `${displayName(portfolio.user)} 작품 ${index + 1}`;
    return (
      <figure>
        <button onClick={() => openAt(img)} className="block w-full">
          <div className="flex aspect-square items-center justify-center">
            <img
              src={img.url}
              alt={alt}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full object-contain hover:opacity-90 transition-opacity"
            />
          </div>
        </button>
        {/* 제목을 안 넣은 작품에 '무제' 를 붙이지 않는다 — 정보가 아니라 소음이다.
            보여줄 게 하나도 없으면 figcaption 자체를 안 그린다(빈 요소가 8px 여백을 먹는다).
            판매상태는 제목이 없어도 알려야 하므로 따로 통과시킨다. */}
        {(titled || st || meta) && (
          <figcaption className="mt-2">
            {(titled || st) && (
              <p className="text-sm text-gray-900">
                {titled && artworkTitle(img)}
                {/* 판매중까지 전부 표기하되, 대부분이 판매중일 테니 강조는 '판매완료'에만 준다 */}
                {st && (
                  <span className={`${titled ? 'ml-2' : ''} text-[11px] font-semibold ${st.tone === 'sold' ? 'text-[#c4302b]' : 'text-gray-400'}`}>
                    ● {st.label}
                  </span>
                )}
              </p>
            )}
            {meta && <p className="text-xs text-gray-500 mt-0.5">{meta}</p>}
          </figcaption>
        )}
      </figure>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* 뒤로가기 */}
      <button onClick={goBack} className="mb-6 inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900 cursor-pointer">
        <ArrowLeft size={16} /> 뒤로가기
      </button>

      {/* 작가 프로필 */}
      <div className="flex items-center gap-4 mb-8">
        {portfolio.user.avatar ? (
          <img src={portfolio.user.avatar} alt={displayName(portfolio.user)} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
            <User size={24} className="text-gray-400" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-medium">{displayName(portfolio.user)}</h1>
          {portfolio.tagline
            ? <p className="text-sm text-gray-600 mt-0.5 break-keep">{portfolio.tagline}</p>
            : <p className="text-sm text-gray-500">아티스트 포트폴리오</p>}
          {safeHttpUrl(portfolio.user.instagramUrl) && (
            <a
              href={safeHttpUrl(portfolio.user.instagramUrl)!}
              target="_blank"
              rel="noreferrer"
              /* 높이가 20px 이라 WCAG 2.2 AA 의 24×24 를 못 넘겼다. 보이는 크기는 그대로 두고
                 세로 히트영역만 넓힌다 */
              className="inline-flex min-h-[44px] items-center gap-1 text-sm text-[#E4405F] hover:text-[#c13584] hover:underline"
            >
              {/* 'Instagram' 이라고만 쓰면 누구 계정인지 눌러보기 전엔 모른다 → 아이디를 보여준다.
                  주소에서 아이디를 못 뽑으면(형식이 이상하면) 종전대로 'Instagram' */}
              <Instagram size={14} /> {instagramHandle(portfolio.user.instagramUrl) ?? 'Instagram'}
            </a>
          )}
        </div>
      </div>

      {/* 작가노트 */}
      {portfolio.statement && (
        <div className="mb-8">
          <SectionTitle>작가노트</SectionTitle>
          {/* 작가가 문장마다 엔터를 친 글은 화면 폭과 안 맞아 문단 오른쪽이 계단처럼 들쭉날쭉해진다.
              이력(줄바꿈=정보)은 그대로 두고 산문만 이어 붙인다(lib/prose.ts). 저장값은 안 건드린다. */}
          <p className="text-[15px] text-gray-700 leading-[1.9] whitespace-pre-wrap break-keep max-w-3xl">{reflowProse(portfolio.statement)}</p>
        </div>
      )}

      {/* 약력 */}
      {portfolio.biography && (
        <div className="mb-6">
          <SectionTitle>작가 약력</SectionTitle>
          <div className="text-sm text-gray-600 whitespace-pre-wrap break-keep max-w-3xl">{reflowProse(portfolio.biography)}</div>
        </div>
      )}

      {/* 경력 */}
      {!careerEmpty && (
        <div className="mb-6">
          <SectionTitle>경력</SectionTitle>
          {/* grid 3열. columns(신문 단) 는 세로로 채워서 개인전+단체전이 한 열에 몰리고
              아트페어만 옆으로 가는 식이라 배치가 예측되지 않았다. grid 는 순서대로 가로로 놓인다.
              items-start 라 항목 수가 달라도 각 칸이 자기 높이만 쓴다. */}
          {/* 여백을 넓힌 이유: 열 간격 40px·항목 간격 2px 로는 긴 항목이 두 줄로 깨졌을 때
              어디까지가 한 항목인지 읽히지 않았다("2025.04 <ART 더불어전> 성남아트센터 808갤러리(성남)").
              열을 벌리고 줄높이를 주면 두 줄이 되어도 한 덩어리로 읽힌다. */}
          <div className="grid gap-x-14 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 items-start max-w-6xl">
            {CAREER_LABELS.map(({ key, label }) => (career[key] ?? []).length > 0 && (
              <div key={key}>
                {/* gray-400 은 흰 배경에서 2.6:1 이라 WCAG AA(4.5) 미달 → gray-500(4.6:1) */}
                <p className="text-xs font-medium text-gray-500 flex items-center gap-1"><Calendar size={11} /> {label}</p>
                <ul className="mt-3 space-y-2">
                  {(career[key] ?? []).map((e, i) => (
                    <li key={i} className="text-sm leading-[1.7] text-gray-600 break-keep">{careerLineText(e)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 포트폴리오 파일 */}
      {safeHttpUrl(portfolio.portfolioFileUrl) && (
        <div className="mb-8">
          <SectionTitle>포트폴리오 파일</SectionTitle>
          <a href={safeHttpUrl(portfolio.portfolioFileUrl)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:underline">
            <FileText size={14} /> 파일 보기
          </a>
        </div>
      )}

      {/* 작품 — 시리즈별로 묶어서 (시리즈가 없으면 제목 없이 그대로) */}
      {totalWorks > 0 && (
        <div className="mb-8">
          <SectionTitle>작품 ({totalWorks})</SectionTitle>
          {/* 예전엔 30장을 **전부 받은 뒤** 한꺼번에 보여줬다(masonry 는 높이를 미리 몰라 줄이 튀었다).
              칸이 정사각이라 높이가 정해졌으니 그 장치가 필요 없다 — 한 장씩 lazy 로 들어와도
              레이아웃이 움직이지 않고 첫 화면이 훨씬 빨리 뜬다. */}
          {groups.map((g, gi) => (
              <div key={g.name || `__${gi}`} className="mb-8 last:mb-0">
                {g.name && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                    {g.note && <p className="text-[13px] text-gray-500 mt-1 leading-relaxed whitespace-pre-wrap break-keep max-w-3xl">{g.note}</p>}
                  </div>
                )}
                {/* 정사각 칸이라 행이 맞는다. 캡션 자리를 위해 세로 간격을 가로보다 넉넉히 */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 md:gap-x-6 md:gap-y-10">
                  {g.images.map(img => (
                    <ArtworkCard key={img.id} img={img} index={ordered.findIndex(o => o.id === img.id)} />
                  ))}
                </div>
              </div>
          ))}
        </div>
      )}


      {/* 빈 포트폴리오 */}
      {!portfolio.biography && !portfolio.statement && careerEmpty && !portfolio.portfolioFileUrl && imageUrls.length === 0 && (
        <div className="text-center py-16 text-gray-400">아직 포트폴리오가 등록되지 않았습니다.</div>
      )}

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
