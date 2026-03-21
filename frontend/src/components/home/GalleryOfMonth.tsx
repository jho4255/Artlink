import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, MapPin } from 'lucide-react';
import api from '@/lib/axios';
import type { GalleryOfMonth } from '@/types';

// 이달의 갤러리 섹션 - 가로 스크롤 카드
export default function GalleryOfMonthSection() {
  const navigate = useNavigate();

  const { data = [] } = useQuery<GalleryOfMonth[]>({
    queryKey: ['gallery-of-month'],
    queryFn: () => api.get('/gallery-of-month').then((r) => r.data),
  });

  if (data.length === 0) return null;

  return (
    <section className="py-12 px-4 md:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 font-serif">Gallery of the Month</h2>
          <span className="text-sm text-gray-400">이달의 추천 갤러리</span>
        </div>

        <div className="flex gap-5 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory">
          {data.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => navigate(`/galleries/${item.gallery.id}`)}
              className="flex-none w-72 cursor-pointer snap-start group hover:-translate-y-1 transition-transform"
            >
              <div className="relative overflow-hidden rounded-2xl shadow-lg">
                <img
                  src={item.gallery.mainImage || 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=400'}
                  alt={item.gallery.name}
                  className="w-72 h-48 object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="mt-3">
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {item.gallery.name}
                </h3>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <MapPin size={14} />
                    {item.gallery.address}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Star size={14} className="text-yellow-400 fill-yellow-400" />
                  <span className="text-sm font-medium">{item.gallery.rating?.toFixed(1)}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
