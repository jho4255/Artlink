import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';

/**
 * 광고 슬롯 — Admin 이 등록한 자체 배너를 노출(사이드바 하단 등).
 *  · `/ads` 의 활성 배너 중 첫 번째를 띄운다(여러 개면 position 순).
 *  · 내부 링크(/...)는 라우팅, 외부(http)면 새 창.
 *  · 우상단에 작은 'AD' 라벨(광고임을 표시 — 블라인드의 AdChoice 자리).
 * 활성 배너가 없으면 아무것도 그리지 않는다.
 */
interface Ad { id: number; imageUrl: string; title: string; linkUrl: string }

export default function AdSlot({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const { data = [] } = useQuery<Ad[]>({
    queryKey: ['ads'],
    queryFn: () => api.get('/ads').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const ad = data[0];
  if (!ad) return null;

  const go = () => {
    if (!ad.linkUrl) return;
    if (ad.linkUrl.startsWith('http')) window.open(ad.linkUrl, '_blank', 'noopener');
    else navigate(ad.linkUrl);
  };

  return (
    <div className={`relative overflow-hidden rounded-lg border border-gray-100 bg-white ${className}`}>
      <button onClick={go} className={`block w-full text-left ${ad.linkUrl ? 'cursor-pointer' : 'cursor-default'}`}>
        <div className="relative">
          <Thumb src={ad.imageUrl} size="grid" alt={ad.title || '광고'} className="w-full object-cover" />
          <span className="absolute right-1 top-1 rounded-sm bg-black/45 px-1 py-0.5 text-[9px] font-medium leading-none text-white/90">AD</span>
        </div>
        {ad.title && <p className="truncate px-2.5 py-2 text-xs text-gray-600">{ad.title}</p>}
      </button>
    </div>
  );
}
