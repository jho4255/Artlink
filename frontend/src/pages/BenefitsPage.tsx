import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import api from '@/lib/axios';
import type { Benefit } from '@/types';

// 혜택 페이지 - Admin이 등록한 혜택 목록
export default function BenefitsPage() {
  const { data: benefits = [], isLoading } = useQuery<Benefit[]>({
    queryKey: ['benefits'],
    queryFn: () => api.get('/benefits').then(r => r.data),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6 font-serif">혜택</h1>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : benefits.length === 0 ? (
        <div className="text-center py-16 text-gray-400">등록된 혜택이 없습니다.</div>
      ) : (
        <div className="space-y-4">
          {benefits.map((benefit, i) => (
            <motion.div
              key={benefit.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden hover:-translate-y-1 hover:shadow-md transition-all"
            >
              {benefit.imageUrl && (
                <img src={benefit.imageUrl} alt={benefit.title} className="w-full h-48 object-cover" />
              )}
              <div className="p-5">
                <h2 className="text-lg font-semibold text-gray-900">{benefit.title}</h2>
                <p className="text-sm text-gray-600 mt-2">{benefit.description}</p>
                {benefit.linkUrl && (
                  <a
                    href={benefit.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-3 text-sm text-blue-500 hover:text-blue-600"
                  >
                    자세히 보기 <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
