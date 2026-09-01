import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import { getShowStatus, regionLabels } from '@/lib/utils';
import type { Show } from '@/types';

/**
 * 진행중인 전시 — 홈 우측 컬럼(구 주목할 갤러리 자리). 좁은 세로 레일.
 * 지금 열려 있는 전시만(getShowStatus === 'ongoing'). 목록 썸네일은 `Thumb`(t240)로 가볍게.
 */
export default function OngoingShows() {
  const navigate = useNavigate();
  const { data = [] } = useQuery<Show[]>({
    queryKey: ['shows', 'home-ongoing'],
    queryFn: () => api.get('/shows?showStatus=ongoing').then((r) => r.data),
  });

  const shows = data.filter((s) => getShowStatus(s.startDate, s.endDate) === 'ongoing').slice(0, 5);
  if (shows.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-serif text-gray-900">진행중인 전시</h2>
        <Link to="/shows" className="text-xs text-gray-500 hover:text-gray-900">전체 →</Link>
      </div>
      <div className="space-y-3">
        {shows.map((s) => (
          <article key={s.id} onClick={() => navigate(`/shows/${s.id}`)} className="group flex cursor-pointer gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-gray-100">
              <Thumb src={s.posterImage || s.gallery?.mainImage || ''} alt={s.title}
                className="h-full w-full object-cover group-hover:opacity-80 transition-opacity" loading="lazy" />
            </div>
            <div className="min-w-0">
              <span className="inline-block rounded-sm bg-[#dc3545]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#dc3545]">진행중</span>
              <h3 className="mt-0.5 truncate font-serif text-[15px] text-gray-900 group-hover:underline">{s.title}</h3>
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-400">
                <MapPin size={11} className="shrink-0" />
                <span className="truncate">{s.gallery?.name || regionLabels[s.region] || s.location}</span>
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
