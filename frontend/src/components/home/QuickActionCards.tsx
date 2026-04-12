import { useNavigate } from 'react-router-dom';

const cards = [
  { en: 'Galleries', label: '갤러리 찾기', path: '/galleries' },
  { en: 'Open Call', label: '모집공고', path: '/exhibitions' },
  { en: 'Exhibitions', label: '전시', path: '/shows' },
  { en: 'Benefits', label: '혜택', path: '/benefits' },
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
          <p className="text-sm text-gray-400 tracking-widest uppercase">
            {card.en}
          </p>
          <h3 className="text-xl md:text-2xl text-gray-900 font-medium mt-1 group-hover:underline underline-offset-4 decoration-1 transition-all">
            {card.label}
          </h3>
        </button>
      ))}
    </nav>
  );
}
