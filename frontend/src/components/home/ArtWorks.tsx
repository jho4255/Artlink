import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Heart, RefreshCw, ArrowRight } from 'lucide-react';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import SkeletonImage from '@/components/shared/SkeletonImage';
import ArtworkDetailModal from '@/components/shared/ArtworkDetailModal';
import type { ExploreImage } from '@/types';

/**
 * 홈 최상단 "ArtWorks" 섹션 (구 Favorites / ExploreHighlight)
 *
 * 홈에 처음 보이는 것이 **작품**이어야 한다 — 예전엔 히어로 배너가 최상단이었다.
 *
 * 제목은 ArtLink 로고와 같은 규칙(앞은 검정, 뒤는 빨강 #dc3545)으로 찍는다 —
 * Art**Link** ↔ Art**Works**. 로고와 짝이 맞아야 브랜드 이름처럼 읽힌다. 부제는 두지 않는다.
 *
 * **첫 진입도 랜덤**이다(2026-08-27). 매번 시드를 새로 만들어 `?seed=N` 으로 부른다.
 *   - 좋아요순으로 고정하면 홈에 걸리는 작품이 늘 같은 얼굴이라, 좋아요가 적은 작가는
 *     아무리 기다려도 홈에 안 나온다. 노출을 골고루 돌리는 쪽을 택했다.
 *   - 대신 "좋아요가 홈 노출을 정한다"는 참여 동기는 사라진다 — 하트 배지는 그대로 찍히고,
 *     좋아요순으로 보려면 [모두 모아보기] → 둘러보기의 [좋아요순] 탭이다.
 *   - 서버는 seed 없이 부르면 여전히 좋아요순이다(그 경로도 테스트로 남아 있다).
 *
 * [새로고침]은 둘러보기(/explore)의 그것과 **같은 동작**(랜덤 재정렬 + 같은 작가 연속 방지).
 * 작품 클릭 시 둘러보기와 동일한 확대 모달을 띄운다(어디서 눌러도 같은 경험).
 *
 * 백엔드 `GET /api/explore/highlight` 참고.
 */
/** 서버가 0·음수·문자를 'seed 없음'으로 보므로 반드시 1 이상이어야 한다. */
const newSeed = () => Math.floor(Math.random() * 1_000_000_000) + 1;

interface HighlightResponse {
  images: ExploreImage[];
  basis: 'all' | 'random';
}

export default function ArtWorks() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExploreImage | null>(null);
  // 홈에 들어올 때마다 새 시드 → 매번 다른 작품. [새로고침]은 시드만 갈아끼운다.
  const [seed, setSeed] = useState(newSeed);

  const { data, isFetching } = useQuery<HighlightResponse>({
    queryKey: ['explore-highlight', seed],
    queryFn: () => api.get('/explore/highlight', { params: { limit: 8, seed } }).then((r) => r.data),
    // 새로고침 중에도 이전 작품을 그대로 두어 섹션이 사라졌다 나타나지 않게 한다
    // (아래 `images.length === 0 → null` 때문에 홈 전체가 위로 튄다).
    placeholderData: (prev) => prev,
  });

  const images = data?.images ?? [];
  if (images.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-8 md:mb-10">
        {/* ArtLink 로고와 같은 색 규칙 — Art(검정) + Works(빨강).
            크기는 **로고보다 확실히 작게** (20/24px vs 로고 30/36px). 회사 이름이 섹션 제목에
            눌려 보이면 안 된다. 아래 Gallery of the Month 제목(24/30px)보다도 작지만,
            여긴 바로 밑에 작품 그리드가 시선을 받으므로 제목이 조용해도 된다. */}
        <h2 className="text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900">
          Art<span className="text-[#dc3545]">Works</span>
        </h2>

        {/* 제목보다는 작지만 **읽히긴 해야 한다** — gray-300/400 으로 뒀더니 안 보인다는 얘기가 나왔다.
            흰 배경에서 gray-300 은 대비 1.5:1 수준이라 사실상 배경이다. gray-500(≈4.6:1)이 하한선. */}
        {/* 새로고침은 **우측 상단** — 무엇을 새로고침하는지 글로 밝힌다(아이콘만으론 안 읽힌다) */}
        <button
          onClick={() => setSeed(newSeed())}
          title="다른 작품 보기 (랜덤 재정렬)"
          className="shrink-0 flex items-center gap-1.5 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          작품 새로고침
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

      {/* 둘러보기 진입점 — Navbar 메뉴에서 뺐으므로 여기가 유일하다.
          작품을 다 본 **뒤에** 나오는 게 자연스러워 격자 우측 하단에 둔다. */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => navigate('/explore')}
          className="flex items-center gap-0.5 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          모두 모아보기 <ArrowRight size={13} />
        </button>
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
