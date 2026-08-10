import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, User, FileText, Calendar, Instagram } from 'lucide-react';
import api from '@/lib/axios';
import { displayName, safeHttpUrl } from '@/lib/utils';
import {
  artworkTitle, captionInline, careerLineText, groupBySeries,
  isCareerEmpty, normalizeCareer, statusLabel,
} from '@/lib/artwork';
import ImageLightbox from '@/components/shared/ImageLightbox';
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
  const navigate = useNavigate();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [imagesReady, setImagesReady] = useState(false);
  const loadedCountRef = useRef(0);

  const { data: portfolio, isLoading, error } = useQuery<PublicPortfolio>({
    queryKey: ['portfolio', userId],
    queryFn: () => api.get(`/portfolio/${userId}`).then(r => r.data),
  });

  // 이미지 프리로드: 모든 이미지 로드 완료 후 한번에 표시 (스켈레톤 → 실제 이미지)
  useEffect(() => {
    if (!portfolio || portfolio.images.length === 0) return;
    setImagesReady(false);
    loadedCountRef.current = 0;
    const total = portfolio.images.length;
    const onComplete = () => {
      loadedCountRef.current += 1;
      if (loadedCountRef.current >= total) setImagesReady(true);
    };
    portfolio.images.forEach(img => {
      const i = new Image();
      i.onload = onComplete;
      i.onerror = onComplete;
      i.src = img.url;
    });
  }, [portfolio]);

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

  // 작품 카드 — 회화를 정사각형으로 자르지 않는다. 원본 비율 그대로 두고 캡션을 아래에 붙인다.
  // (기존에는 aspect-square + object-cover라 세로로 긴 작품이 잘려 나갔다)
  const ArtworkCard = ({ img }: { img: PortfolioImage }) => {
    const st = statusLabel(img);
    const meta = captionInline(img);
    return (
      <figure className="mb-6 break-inside-avoid">
        <button onClick={() => openAt(img)} className="block w-full bg-gray-50">
          <img src={img.url} alt={artworkTitle(img)} loading="lazy" className="w-full h-auto hover:opacity-90 transition-opacity" />
        </button>
        <figcaption className="mt-2">
          <p className="text-sm text-gray-900">
            {artworkTitle(img)}
            {st && <span className="ml-2 text-[11px] font-semibold text-[#c4302b]">● {st}</span>}
          </p>
          {meta && <p className="text-xs text-gray-500 mt-0.5">{meta}</p>}
        </figcaption>
      </figure>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* 뒤로가기 */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6">
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
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mt-1"
            >
              <Instagram size={14} /> Instagram
            </a>
          )}
        </div>
      </div>

      {/* 작가노트 */}
      {portfolio.statement && (
        <div className="mb-8">
          <SectionTitle>작가노트</SectionTitle>
          <p className="text-[15px] text-gray-700 leading-[1.9] whitespace-pre-wrap break-keep max-w-3xl">{portfolio.statement}</p>
        </div>
      )}

      {/* 약력 */}
      {portfolio.biography && (
        <div className="mb-6">
          <SectionTitle>작가 약력</SectionTitle>
          <div className="text-sm text-gray-600 whitespace-pre-wrap break-keep max-w-3xl">{portfolio.biography}</div>
        </div>
      )}

      {/* 경력 */}
      {!careerEmpty && (
        <div className="mb-6">
          <SectionTitle>경력</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3 max-w-3xl">
            {CAREER_LABELS.map(({ key, label }) => (career[key] ?? []).length > 0 && (
              <div key={key}>
                <p className="text-xs font-medium text-gray-400 flex items-center gap-1"><Calendar size={11} /> {label}</p>
                <ul className="mt-1 space-y-0.5">
                  {(career[key] ?? []).map((e, i) => (
                    <li key={i} className="text-sm text-gray-600">{careerLineText(e)}</li>
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
          {!imagesReady ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: Math.min(totalWorks, 6) }).map((_, i) => (
                <div key={i} className="aspect-[4/5] bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : (
            groups.map((g, gi) => (
              <div key={g.name || `__${gi}`} className="mb-8 last:mb-0">
                {g.name && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                    {g.note && <p className="text-[13px] text-gray-500 mt-1 leading-relaxed whitespace-pre-wrap break-keep max-w-3xl">{g.note}</p>}
                  </div>
                )}
                <div className="columns-2 md:columns-3 gap-4">
                  {g.images.map(img => <ArtworkCard key={img.id} img={img} />)}
                </div>
              </div>
            ))
          )}
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
