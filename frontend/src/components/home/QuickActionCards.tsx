import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Megaphone, Image, Gift } from 'lucide-react';

const cards = [
  { icon: Search, label: '갤러리 찾기', desc: '다양한 갤러리를 탐색하세요', path: '/galleries', color: 'bg-blue-50 text-blue-600' },
  { icon: Megaphone, label: '진행중인 공고', desc: '모집 공고를 확인하세요', path: '/exhibitions', color: 'bg-orange-50 text-orange-600' },
  { icon: Image, label: '전시', desc: '갤러리 전시를 둘러보세요', path: '/shows', color: 'bg-green-50 text-green-600' },
  { icon: Gift, label: '혜택', desc: '아티스트를 위한 혜택', path: '/benefits', color: 'bg-purple-50 text-purple-600' },
];

// 퀵 액션 카드 - 4개의 주요 페이지 바로가기
export default function QuickActionCards() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-4 gap-4 max-w-3xl mx-auto">
      {cards.map((card, i) => (
        <motion.button
          key={card.path}
          onClick={() => navigate(card.path)}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1, duration: 0.4 }}
          whileHover={{ scale: 1.03, y: -2 }}
          className="flex flex-col items-center p-5 md:p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className={`p-3 rounded-xl mb-3 ${card.color}`}>
            <card.icon size={24} />
          </div>
          <span className="text-sm font-semibold text-gray-900">{card.label}</span>
          <span className="text-xs text-gray-400 mt-1 hidden md:block">{card.desc}</span>
        </motion.button>
      ))}
    </div>
  );
}
