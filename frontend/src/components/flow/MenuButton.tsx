import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MenuItem {
  /** 같은 이름의 항목이 둘일 수 있을 때(사용자가 지은 이름) 구분할 열쇠. 없으면 label */
  id?: string;
  label: string;
  /** 항목 아래 작은 설명 */
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * [내려받기 ▾] 같은 묶음 메뉴 — 공모 흐름 화면 공통 (2026-09-29).
 *
 * 운영 화면 한 줄에 캡션(한글)·작품 원본(ZIP)·전체 PDF(ZIP)·도록 PDF·정산서 PDF·현금 정산서·카드 정산서가
 * 전부 버튼으로 나란히 있었다. 하는 일은 '파일 받기' 하나라 한 버튼 아래로 모은다.
 *
 * 떠 있는 메뉴에만 옅은 그림자를 준다(카드에는 그림자를 쓰지 않는다 — 흰 판 위에 흰 판이 떠 있다는 걸
 * 테두리만으로는 못 알아본다). 바깥을 누르거나 Esc 로 닫힌다.
 */
export default function MenuButton({ label, icon, items, busyLabel, align = 'right', className }: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  /** 작업 중이면 버튼 글자를 이걸로 바꾸고 잠근다(예: '이미지 3/12'). 진행률은 사라지는 토스트가 아니라 버튼에(2026-08) */
  busyLabel?: string | null;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const busy = !!busyLabel;
  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70"
      >
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : icon}
        {busy ? busyLabel : label}
        {!busy && <ChevronDown size={13} className={cn('text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-30 mt-1 w-max min-w-[200px] max-w-[min(300px,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white py-1 shadow-[0_8px_24px_rgba(17,24,39,0.08)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it) => (
            <button
              key={it.id ?? it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect(); }}
              className="flex w-full flex-col items-start gap-0.5 px-3.5 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              <span>{it.label}</span>
              {it.hint && <span className="text-xs text-gray-400">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
