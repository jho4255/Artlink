import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Star, MapPin } from 'lucide-react';
import api from '@/lib/axios';
import SkeletonImage from '@/components/shared/SkeletonImage';
import type { GalleryOfMonth } from '@/types';

/**
 * @param variant 'grid'(기본, PC 4열 풀섹션) | 'rail'(홈 우측 컬럼용 세로 리스트)
 */
export default function GalleryOfMonthSection({ variant = 'grid' }: { variant?: 'grid' | 'rail' }) {
  const navigate = useNavigate();

  const { data = [] } = useQuery<GalleryOfMonth[]>({
    queryKey: ['gallery-of-month'],
    queryFn: () => api.get('/gallery-of-month').then((r) => r.data),
  });

  if (data.length === 0) return null;

  // 홈 우측 레일 — 좁은 컬럼이라 세로 리스트(작은 카드)로. 뷰포트 media query 로는 컬럼 폭을 못 재서
  // 4열 grid 를 그대로 두면 좁은 컬럼에서 4칸으로 뭉개진다(container query 미사용).
  if (variant === 'rail') {
    return (
      <section>
        <h2 className="mb-4 text-lg font-serif text-gray-900">주목할 갤러리</h2>
        <div className="space-y-3">
          {data.slice(0, 4).map((item) => (
            <article
              key={item.id}
              onClick={() => navigate(`/galleries/${item.gallery.id}`)}
              className="group flex cursor-pointer gap-3"
            >
              <SkeletonImage
                src={item.gallery.mainImage || ''}
                alt={item.gallery.name}
                fallbackLabel={item.gallery.name}
                className="h-16 w-16 shrink-0 overflow-hidden rounded"
                imgClassName="object-cover group-hover:opacity-80 transition-opacity"
                loading="lazy"
              />
              <div className="min-w-0">
                <h3 className="truncate font-serif text-[15px] text-gray-900 group-hover:underline">{item.gallery.name}</h3>
                {(item.gallery.reviewCount ?? 0) > 0 ? (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-[#c4302b]">
                    <Star size={12} className="fill-[#c4302b]" /> {item.gallery.rating?.toFixed(1)}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-gray-400">아직 리뷰 없음</span>
                )}
                <p className="mt-0.5 flex items-start gap-1 truncate text-xs text-gray-400">
                  <MapPin size={11} className="mt-0.5 shrink-0" /> <span className="truncate">{item.gallery.address}</span>
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      {/* 섹션 헤더 */}
      <h2 className="mb-8 text-2xl md:text-3xl font-serif text-gray-900 md:mb-10">주목할 갤러리</h2>

      {/* 그리드 — PC 4열, 모바일 1열 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-5">
        {data.map((item) => (
          <article
            key={item.id}
            onClick={() => navigate(`/galleries/${item.gallery.id}`)}
            className="group cursor-pointer"
          >
            {/* 이미지 — 직각, 그림자 없음 */}
            <SkeletonImage
              src={item.gallery.mainImage || ''}
              alt={item.gallery.name}
              fallbackLabel={item.gallery.name}
              className="aspect-[4/3]"
              imgClassName="object-cover group-hover:opacity-80 transition-opacity duration-300"
              loading="lazy"
            />

            {/* 정보 */}
            <div className="mt-3">
              {/* 별점 — 유일한 컬러 포인트. 리뷰 0건이면 '아직 리뷰 없음' */}
              <div className="flex items-center gap-1.5 mb-2">
                {(item.gallery.reviewCount ?? 0) > 0 ? (
                  <>
                    <Star size={16} className="text-[#c4302b] fill-[#c4302b]" />
                    <span className="text-base font-medium text-[#c4302b]">
                      {item.gallery.rating?.toFixed(1)}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-400">아직 리뷰 없음</span>
                )}
              </div>

              <h3 className="font-serif text-xl text-gray-900 hover:underline underline-offset-2 decoration-1">
                {item.gallery.name}
              </h3>

              {item.title && (
                <p className="text-[13px] text-gray-600 mt-1.5 tracking-wide">
                  {item.title}
                </p>
              )}

              <p className="flex items-start gap-1.5 mt-2 text-base text-gray-400">
                <MapPin size={15} className="shrink-0 mt-1" />
                {item.gallery.address}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
