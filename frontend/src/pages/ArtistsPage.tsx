/**
 * ArtistsPage — Navbar [작가] 탭 (2026-09-10)
 *
 * 왼쪽에 **작가 목록**, 오른쪽에 **작품 격자**. 작가 이름을 누르면 그 작가의 공개 홈페이지
 * (`/portfolio/:id`)로 간다. 홈의 `ArtWorks` 섹션이 맛보기였다면 여기가 본판이다.
 *
 * ## 왜 별도 페이지인가
 * `ArtWorks` 는 홈 안의 한 섹션이라 [작가] 탭이 갈 곳이 마땅치 않았다. 홈으로 보내면
 * [홈]과 [작가]가 같은 주소가 되어 탭이 둘일 이유가 없어진다.
 *
 * ## 목록에 누가 들어가나
 * **공개 작품이 한 장이라도 있는 작가만** (`GET /explore/artists`). 가입만 한 계정까지 실으면
 * 목록이 회원 명부가 되고, 눌러 들어가면 텅 빈 홈페이지가 나온다.
 *
 * ## 순서는 랜덤 (2026-09-10 사용자 요청)
 * 가나다순이면 'ㄱ' 으로 시작하는 작가만 늘 맨 위에 걸린다. 화면이 들어올 때마다 새 시드를 만들고
 * [순서 바꾸기]가 시드만 갈아끼운다 — 작품 격자의 [작품 새로고침]과 **별개 축**이다.
 *   ⚠️ 둘을 한 버튼으로 합치지 말 것. 작가를 훑던 중에 작품까지 통째로 바뀌면 보던 자리를 잃는다.
 * ⚠️ **작품 수는 화면에 안 그린다**(2026-09-10). 응답에는 남아 있다 — 그 값이 0 이면 애초에
 *    목록에 없어야 하므로, 회귀 테스트가 그걸로 필터를 검증한다.
 *
 * ⚠️ 작가 이름을 눌러 **격자를 거르지 않는다** — 사용자가 원한 동작은 '그 작가에게 가는 것'이다.
 *    거르기까지 하면 눌렀을 때 무슨 일이 나는지 두 가지가 되어 예측이 안 된다.
 * ⚠️ 작품 격자는 홈과 **같은 규칙**(랜덤 + 같은 작가 연속 방지, [새로고침]은 시드만 교체)을 쓴다.
 *    두 화면에서 누른 느낌이 달라지면 안 된다.
 *
 * @see backend/src/routes/explore.ts — GET /explore/artists · GET /explore/highlight
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Heart, RefreshCw, ArrowRight } from 'lucide-react';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import SkeletonImage from '@/components/shared/SkeletonImage';
import ArtworkDetailModal from '@/components/shared/ArtworkDetailModal';
import type { ExploreImage } from '@/types';

interface ArtistEntry {
  id: number;
  name: string;
  avatar: string | null;
  /** 공개 작품 수 — **화면에 그리지 않는다**(2026-09-10). 목록 필터의 근거라 응답에는 남아 있다. */
  workCount: number;
}

interface HighlightResponse {
  images: ExploreImage[];
  basis: 'all' | 'random';
}

/** 서버가 0·음수·문자를 'seed 없음'으로 보므로 반드시 1 이상이어야 한다. */
const newSeed = () => Math.floor(Math.random() * 1_000_000_000) + 1;

export default function ArtistsPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ExploreImage | null>(null);
  const [seed, setSeed] = useState(newSeed);
  // 작가 순서와 작품 순서는 **별개 시드**다 — 한쪽을 바꿔도 다른 쪽은 그대로 있어야 한다
  const [artistSeed, setArtistSeed] = useState(newSeed);

  const { data: artists = [], isLoading: artistsLoading, isFetching: artistsFetching } = useQuery<ArtistEntry[]>({
    queryKey: ['explore-artists', artistSeed],
    queryFn: () => api.get('/explore/artists', { params: { seed: artistSeed } }).then((r) => r.data),
    // 섞는 중에도 이전 목록을 그대로 둔다 — 안 그러면 왼쪽이 통째로 비었다 나타나 화면이 튄다
    placeholderData: (prev) => prev,
  });

  const { data, isFetching } = useQuery<HighlightResponse>({
    queryKey: ['explore-highlight', seed, 'artists-page'],
    // 홈보다 넓은 화면이라 더 많이 받는다(홈은 8장)
    queryFn: () => api.get('/explore/highlight', { params: { limit: 24, seed } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
  const images = data?.images ?? [];

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* ⚠️ `min-w-0` 필수 — 안 붙이면 오른쪽 격자의 min-content 가 트랙을 밀어
          좁은 화면에서 페이지 전체가 가로로 밀린다(CLAUDE.md 27번). */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-12">
        {/* ── 왼쪽: 작가 목록 ─────────────────────────────── */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <h1 className="font-serif text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            Art<span className="text-[#dc3545]">Works</span>
          </h1>
          <div className="mt-1 flex items-center justify-between gap-2 lg:justify-start lg:gap-3">
            <p className="text-sm text-gray-400">{artistsLoading ? ' ' : `작가 ${artists.length}명`}</p>
            {artists.length > 1 && (
              <button
                onClick={() => setArtistSeed(newSeed())}
                title="작가 순서 바꾸기 (랜덤 재정렬)"
                className="flex shrink-0 cursor-pointer items-center gap-1 py-2 text-xs text-gray-500 transition-colors hover:text-gray-900"
              >
                <RefreshCw size={12} className={artistsFetching ? 'animate-spin' : ''} />
                순서 바꾸기
              </button>
            )}
          </div>

          {artistsLoading ? (
            <ul className="mt-5 space-y-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="h-4 w-24 animate-pulse rounded bg-gray-100" />
              ))}
            </ul>
          ) : artists.length === 0 ? (
            <p className="mt-5 text-sm text-gray-400">아직 작품을 공개한 작가가 없습니다.</p>
          ) : (
            /* 이름 목록 — **랜덤 순서**(서버가 시드로 섞어 내려준다). PC 는 한 줄에 하나, 모바일은 접히도록 흐른다.
               ⚠️ `<Link>` 로 둘 것 — 새 탭·주소 복사·키보드 접근이 되어야 한다(버튼이면 다 막힌다). */
            <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 lg:block lg:space-y-0.5">
              {artists.map((a) => (
                <li key={a.id} className="min-w-0">
                  <Link
                    to={`/portfolio/${a.id}`}
                    className="flex min-h-[36px] items-baseline text-sm text-gray-600 hover:text-gray-900 hover:underline hover:underline-offset-4"
                  >
                    <span className="truncate">{a.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── 오른쪽: 작품 격자 ───────────────────────────── */}
        <section className="min-w-0">
          <div className="mb-5 flex items-center justify-end">
            <button
              onClick={() => setSeed(newSeed())}
              title="다른 작품 보기 (랜덤 재정렬)"
              className="flex shrink-0 cursor-pointer items-center gap-1.5 py-2 text-sm text-gray-500 transition-colors hover:text-gray-900"
            >
              <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
              작품 새로고침
            </button>
          </div>

          {images.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">공개된 작품이 아직 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
              {images.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setSelected(img)}
                  className="group relative aspect-square cursor-pointer overflow-hidden"
                  aria-label={`${displayName(img.artist)} 작가의 작품 — 크게 보기`}
                >
                  <SkeletonImage
                    src={img.url}
                    className="absolute inset-0"
                    imgClassName="object-cover group-hover:opacity-80 transition-opacity duration-300"
                    loading="lazy"
                  />
                  {/* 그라데이션에 pointer-events-none 필수 — 없으면 아래 버튼 클릭을 막는다(CLAUDE.md 8번) */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-2">
                    <span className="truncate text-xs text-white/90">{displayName(img.artist)}</span>
                    {img.likeCount > 0 && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-white">
                        <Heart size={11} className="fill-white" />
                        {img.likeCount}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => navigate('/explore')}
              className="flex cursor-pointer items-center gap-0.5 py-2 text-sm text-gray-500 transition-colors hover:text-gray-900"
            >
              모두 모아보기 <ArrowRight size={13} />
            </button>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {selected && (
          <ArtworkDetailModal
            image={selected}
            onClose={() => setSelected(null)}
            onUpdate={(updated) => setSelected(updated)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
