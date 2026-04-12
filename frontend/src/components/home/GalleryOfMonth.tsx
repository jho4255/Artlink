import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Star, MapPin } from 'lucide-react';
import api from '@/lib/axios';
import type { GalleryOfMonth } from '@/types';

export default function GalleryOfMonthSection() {
  const navigate = useNavigate();

  const { data = [] } = useQuery<GalleryOfMonth[]>({
    queryKey: ['gallery-of-month'],
    queryFn: () => api.get('/gallery-of-month').then((r) => r.data),
  });

  if (data.length === 0) return null;

  return (
    <section>
      {/* 섹션 헤더 — SPACE 스타일 */}
      <div className="mb-8 md:mb-10">
        <h2 className="text-4xl md:text-5xl font-serif text-gray-900">
          Gallery of the Month
        </h2>
        <p className="text-base text-gray-400 tracking-wide mt-3">
          ArtLink 선정 이달의 갤러리
        </p>
      </div>

      {/* 그리드 — PC 4열, 모바일 1열 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-5">
        {data.map((item) => (
          <article
            key={item.id}
            onClick={() => navigate(`/galleries/${item.gallery.id}`)}
            className="group cursor-pointer"
          >
            {/* 이미지 — 직각, 그림자 없음 */}
            <div className="overflow-hidden">
              <img
                src={item.gallery.mainImage || '/images/gallery-sculpture.webp'}
                alt={item.gallery.name}
                className="w-full aspect-[4/3] object-cover group-hover:opacity-80 transition-opacity duration-300"
              />
            </div>

            {/* 정보 */}
            <div className="mt-3">
              {/* 별점 — 유일한 컬러 포인트 */}
              <div className="flex items-center gap-1.5 mb-2">
                <Star size={16} className="text-[#c4302b] fill-[#c4302b]" />
                <span className="text-base font-medium text-[#c4302b]">
                  {item.gallery.rating?.toFixed(1)}
                </span>
              </div>

              <h3 className="font-serif text-xl text-gray-900 hover:underline underline-offset-2 decoration-1">
                {item.gallery.name}
              </h3>

              {item.title && (
                <p className="text-[13px] text-gray-600 mt-1.5 tracking-wide">
                  {item.title}
                </p>
              )}

              <p className="flex items-center gap-1.5 mt-2 text-base text-gray-400">
                <MapPin size={15} />
                {item.gallery.address}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
