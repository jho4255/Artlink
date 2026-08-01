import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Heart, ArrowRight } from 'lucide-react';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import SkeletonImage from '@/components/shared/SkeletonImage';
import ArtworkDetailModal from '@/components/shared/ArtworkDetailModal';
import type { ExploreImage } from '@/types';

/**
 * 홈 "Favorites" 섹션
 *
 * 목적이 두 가지다.
 *  1) 홈 방문자를 둘러보기로 흘려보내는 진입점 (이전엔 Navbar 메뉴가 유일했다)
 *  2) **좋아요에 결과를 만들어주는 장치** — 좋아요가 "홈에 무엇이 걸릴지"를 정하면
 *     누르는 행위가 단순 호감 표시에서 큐레이션 참여로 바뀐다. 부제로 그 근거를 밝힌다.
 *
 * 정렬은 **전체 좋아요 수 내림차순**(카드 배지와 같은 값). 좋아요가 전무하면 날짜 시드 랜덤.
 * 백엔드 `GET /api/explore/highlight` 참고.
 * 작품 클릭 시 둘러보기와 동일한 확대 모달을 띄운다(어디서 눌러도 같은 경험).
 */
// 제목은 홈의 다른 섹션(Gallery of the Month)과 같은 영문 serif로 통일하고, 부제로 근거를 밝힌다.
// ⚠️ 부제에 '이번 주'를 쓰지 않는다 — 정렬은 전체 좋아요 수(=카드에 찍히는 배지) 기준이라
//    주간 문구를 달면 "하트순이 아닌 것처럼" 보인다(실제로 그런 신고가 있었다).
const LABELS: Record<string, { title: string; subtitle: string }> = {
  all: { title: 'Favorites', subtitle: '가장 많이 사랑받은 작품들' },
  random: { title: 'Favorites', subtitle: '마음에 드는 작품에 좋아요를 눌러보세요' },
};

interface HighlightResponse {
  images: ExploreImage[];
  basis: 'all' | 'random';
}

export default function ExploreHighlight() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExploreImage | null>(null);

  const { data } = useQuery<HighlightResponse>({
    queryKey: ['explore-highlight'],
    queryFn: () => api.get('/explore/highlight', { params: { limit: 8 } }).then((r) => r.data),
  });

  const images = data?.images ?? [];
  if (images.length === 0) return null;

  const label = LABELS[data?.basis ?? 'random'] ?? LABELS.random;

  return (
    <section>
      <div className="flex items-end justify-between gap-4 mb-8 md:mb-10">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif text-gray-900">{label.title}</h2>
          <p className="text-sm text-gray-400 tracking-wide mt-2">{label.subtitle}</p>
        </div>
        <button
          onClick={() => navigate('/explore')}
          className="shrink-0 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          전체 보기 <ArrowRight size={14} />
        </button>
      </div>

      {/* 모바일 2열 / 태블릿 3열 / PC 4열 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
        {images.map((img) => (
          <button
            key={img.id}
            onClick={() => setSelected(img)}
            className="group relative aspect-square overflow-hidden cursor-pointer"
            aria-label={`${displayName(img.artist)} 작가의 작품 — 크게 보기`}
          >
            <SkeletonImage
              src={img.url}
              className="absolute inset-0"
              imgClassName="object-cover group-hover:opacity-80 transition-opacity duration-300"
              loading="lazy"
            />
            {/* 하단 그라데이션 — 클릭 차단 방지를 위해 pointer-events-none 필수 */}
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 p-2 flex items-center justify-between pointer-events-none">
              <span className="text-xs text-white/90 truncate">{displayName(img.artist)}</span>
              {img.likeCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-white shrink-0">
                  <Heart size={11} className="fill-white" />
                  {img.likeCount}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* 홈에서도 둘러보기와 동일하게 원본 비율로 확대된다 */}
      <AnimatePresence>
        {selected && (
          <ArtworkDetailModal
            image={selected}
            onClose={() => setSelected(null)}
            onUpdate={(updated) => setSelected(updated)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
