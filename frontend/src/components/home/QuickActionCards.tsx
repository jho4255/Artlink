import { useNavigate } from 'react-router-dom';

const cards = [
  { label: '갤러리 찾기', desc: '다양한 갤러리를 탐색하세요', path: '/galleries' },
  { label: '모집공고', desc: '진행 중인 공고를 확인하세요', path: '/exhibitions' },
  { label: '전시', desc: '갤러리 전시를 둘러보세요', path: '/shows' },
  { label: '혜택', desc: '아티스트를 위한 혜택', path: '/benefits' },
];

export default function QuickActionCards() {
  const navigate = useNavigate();

  return (
    <nav className="grid grid-cols-2 md:grid-cols-4 max-w-7xl mx-auto">
      {cards.map((card) => (
        <button
          key={card.path}
          onClick={() => navigate(card.path)}
          className="group py-6 md:py-8 text-center cursor-pointer"
        >
          <h3 className="text-xl md:text-2xl text-gray-900 font-medium group-hover:underline underline-offset-4 decoration-1 transition-all">
            {card.label}
          </h3>
          <p className="text-base text-gray-400 mt-2 leading-relaxed">
            {card.desc}
          </p>
        </button>
      ))}
    </nav>
  );
}
