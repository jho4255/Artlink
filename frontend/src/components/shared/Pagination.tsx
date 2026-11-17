import { useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageItems } from '@/lib/pagination';

/**
 * 페이지 번호 줄 — ‹ 1 … 4 5 [6] 7 8 … 20 › (2026-11-13, 커뮤니티 목록).
 * 휴대폰(<640px)은 지금 쪽 양옆 한 쪽씩만(줄이 넘치지 않게). 누르는 곳은 40px 이상. 지금 쪽은 `aria-current="page"`.
 */
const NARROW = '(max-width: 639px)';
const subscribe = (fn: () => void) => {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null;
  if (!mq) return () => {};
  if (mq.addEventListener) mq.addEventListener('change', fn); else mq.addListener?.(fn);
  return () => { if (mq.removeEventListener) mq.removeEventListener('change', fn); else mq.removeListener?.(fn); };
};
const readNarrow = () => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW).matches;

export default function Pagination({ page, total, onChange, label = '페이지' }: {
  page: number; total: number; onChange: (page: number) => void; label?: string;
}) {
  const narrow = useSyncExternalStore(subscribe, readNarrow, () => false);
  if (total <= 1) return null;
  const items = pageItems(page, total, narrow ? 1 : 2);
  const arrow = 'inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-30';
  return (
    <nav aria-label={label} className="flex items-center justify-center gap-0.5" data-pagination>
      <button type="button" className={arrow} onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="이전 페이지"><ChevronLeft size={18} /></button>
      {items.map((it, i) => it === '…'
        ? <span key={`gap-${i}`} aria-hidden="true" className="inline-flex h-10 w-7 items-center justify-center text-[14px] text-gray-400">…</span>
        : (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            aria-current={it === page ? 'page' : undefined}
            aria-label={`${it}페이지`}
            className={`inline-flex h-10 min-w-10 items-center justify-center rounded-md px-2 text-[15px] tabular-nums ${it === page ? 'bg-gray-900 font-semibold text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {it}
          </button>
        ))}
      <button type="button" className={arrow} onClick={() => onChange(page + 1)} disabled={page >= total} aria-label="다음 페이지"><ChevronRight size={18} /></button>
    </nav>
  );
}
