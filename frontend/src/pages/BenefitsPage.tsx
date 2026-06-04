import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import api from '@/lib/axios';
import SkeletonImage from '@/components/shared/SkeletonImage';
import type { Benefit } from '@/types';

// 혜택 페이지 - Admin이 등록한 혜택 목록
export default function BenefitsPage() {
  const { data: benefits = [], isLoading } = useQuery<Benefit[]>({
    queryKey: ['benefits'],
    queryFn: () => api.get('/benefits').then(r => r.data),
  });

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      <h1 className="text-4xl md:text-5xl font-serif text-gray-900">Benefits</h1>
      <p className="text-base text-gray-400 mt-2 mb-10">아티스트를 위한 혜택</p>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="aspect-[4/3] bg-gray-100 animate-pulse rounded-lg" />)}
        </div>
      ) : benefits.length === 0 ? (
        <div className="text-center py-16 text-gray-400">등록된 혜택이 없습니다.</div>
      ) : (
        /* PC 3열 / 태블릿 2열 / 모바일 1열 */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {benefits.map((benefit) => (
            <div
              key={benefit.id}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow flex flex-col"
            >
              {benefit.imageUrl && (
                /* 박스 크기 고정(4:3), 이미지는 비율 유지(contain) — 잘림/찌그러짐 없음, 여백은 블러로 채움 */
                <SkeletonImage src={benefit.imageUrl} alt={benefit.title} className="w-full aspect-[4/3]" imgClassName="object-contain" blurFill />
              )}
              <div className="p-5 flex-1 flex flex-col">
                <h2 className="text-lg font-semibold text-gray-900">{benefit.title}</h2>
                <p className="text-sm text-gray-600 mt-2 flex-1 whitespace-pre-wrap break-words">{benefit.description}</p>
                {benefit.linkUrl && (
                  <a
                    href={benefit.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-3 text-sm text-gray-400 hover:text-gray-900"
                  >
                    자세히 보기 <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
