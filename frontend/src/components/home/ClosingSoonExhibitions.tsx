import { useLayoutEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import { getDday, regionLabels } from '@/lib/utils';
import { HomeTabHead, HomeTabAll } from './HomeTabHead';
import type { Exhibition } from '@/types';

/**
 * 마감임박 공모 — 홈 하단 좌측(주목할 갤러리와 1:1).
 * `/exhibitions?scope=open` 은 이미 마감일 오름차순(=임박순)이라 앞에서부터 자른다.
 * 이미 지난 것(dday<0)·수동마감은 scope=open 에서 서버가 걸러준다.
 */
const ddayLabel = (d: number) => (d === 0 ? 'D-day' : d > 0 ? `D-${d}` : '마감');

/**
 * @param bare 휴대폰 홈 탭 안(2026-11-14, `lib/homeTabs.ts`) — 제목은 탭이 대신하고 링크는 [전체 보기]
 * @param onEmpty 답이 오면 비었는지 알린다 — 모집 중인 공고가 없으면 홈이 이 탭을 감춘다
 */
export default function ClosingSoonExhibitions({ bare = false, onEmpty }: { bare?: boolean; onEmpty?: (empty: boolean) => void } = {}) {
  const navigate = useNavigate();
  const { data = [], isSuccess, isError } = useQuery<Exhibition[]>({
    queryKey: ['exhibitions', 'home-closing'],
    queryFn: () => api.get('/exhibitions?scope=open').then((r) => r.data),
  });

  const items = data.filter((e) => getDday(e.deadline) >= 0).slice(0, 4);
  const known = isSuccess || isError;
  const empty = items.length === 0;
  useLayoutEffect(() => {
    if (known) onEmpty?.(empty);
  }, [known, empty, onEmpty]);
  if (items.length === 0) return null;

  return (
    <section>
      {bare ? (
        <HomeTabHead><HomeTabAll to="/exhibitions" /></HomeTabHead>
      ) : (
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-serif text-gray-900">마감임박 공모</h2>
          <Link to="/exhibitions" className="text-xs text-gray-500 hover:text-gray-900">전체 →</Link>
        </div>
      )}
      <div className="space-y-3">
        {items.map((ex) => {
          const d = getDday(ex.deadline);
          const urgent = d <= 3;
          return (
            <article key={ex.id} onClick={() => navigate(`/exhibitions/${ex.id}`)} className="group flex cursor-pointer gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-gray-100">
                <Thumb src={ex.imageUrl || ex.gallery?.mainImage || ''} alt={ex.title}
                  className="h-full w-full object-cover group-hover:opacity-80 transition-opacity" loading="lazy" />
              </div>
              <div className="min-w-0">
                <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${urgent ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {ddayLabel(d)}
                </span>
                <h3 className="mt-0.5 truncate font-serif text-[15px] text-gray-900 group-hover:underline">{ex.title}</h3>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-400">
                  <MapPin size={11} className="shrink-0" />
                  <span className="truncate">{ex.gallery?.name || regionLabels[ex.region] || ''}</span>
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
