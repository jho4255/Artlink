import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
export default function MenuButton({ label, icon, items, busyLabel, align = 'right', className, iconOnly = false }: {
  label: string;
  icon?: ReactNode;
  /** 아이콘만(공모 한 건 화면의 [⋯]) — label 은 화면 낭독기 이름이 된다 */
  iconOnly?: boolean;
  items: MenuItem[];
  /** 작업 중이면 버튼 글자를 이걸로 바꾸고 잠근다(예: '이미지 3/12'). 진행률은 사라지는 토스트가 아니라 버튼에(2026-08) */
  busyLabel?: string | null;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* 아래가 막히면 위로 연다 (2026-11-20 — 휴대폰의 하단 고정 줄·탭바가 메뉴 아래쪽을 덮어 [작품 원본] 이 안 눌렸다).
     그려 보고 맨 아래 항목 자리에 실제로 무엇이 잡히는지(elementFromPoint)로 판단한다 — 막는 줄이 화면마다 달라서
     목록으로 적지 않는다. 위로 열어도 더 나쁘면(위가 더 좁다) 아래 그대로. 상태가 아니라 속성으로 바꿔 한 번에 그린다. */
  useLayoutEffect(() => {
    const m = menuRef.current;
    if (!open || !m) return;
    m.removeAttribute('data-up');
    m.removeAttribute('data-flip-x');
    // 좌우 — 정한 쪽 끝에 맞췄더니 화면 밖으로 나가면 반대쪽 끝에 맞춘다(2026-11-20 앱: 휴대폰에서 왼쪽에 놓인 [내려받기]의
    // 메뉴가 오른쪽 끝 맞춤이라 화면 왼쪽 밖으로 잘렸다 — 항목 가운데는 화면 안이라 누르는 검사로는 안 잡혔다)
    const EDGE = 8;
    const h0 = m.getBoundingClientRect();
    if (align === 'right' ? h0.left < EDGE : h0.right > window.innerWidth - EDGE) m.setAttribute('data-flip-x', '');
    // 뒤집어도 넘치면(버튼이 좁은 화면 가운데) 넘친 만큼만 화면 안으로 민다
    const h1 = m.getBoundingClientRect();
    const dx = h1.left < EDGE ? EDGE - h1.left : h1.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - h1.right : 0;
    m.style.transform = dx ? `translateX(${Math.round(dx)}px)` : '';
    const covered = (r: DOMRect) => {
      const y = r.bottom - 6;
      if (y >= window.innerHeight) return true;
      const hit = document.elementFromPoint(r.left + r.width / 2, y);
      return !!hit && !m.contains(hit);
    };
    const down = m.getBoundingClientRect();
    if (!covered(down)) return;
    m.setAttribute('data-up', '');
    const up = m.getBoundingClientRect();
    const topHit = document.elementFromPoint(up.left + up.width / 2, up.top + 6);
    if (up.top < 0 || (!!topHit && !m.contains(topHit))) m.removeAttribute('data-up');
  }, [open, align]);

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
      {iconOnly ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((v) => !v)}
          className="grid h-11 w-11 place-items-center rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-950"
        >
          {icon}
        </button>
      ) : (
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70"
      >
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : icon}
        {busy ? busyLabel : label}
        {!busy && <ChevronDown size={13} className={cn('text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      )}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          data-back-closes
          className={cn(
            // z-[35]: 하단 고정 줄(z-30) 위 · 하단 탭바(z-40)·창(z-50) 아래
            'absolute top-full z-[35] mt-1 data-[up]:top-auto data-[up]:bottom-full data-[up]:mt-0 data-[up]:mb-1 w-max min-w-[200px] max-w-[min(300px,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white py-1 shadow-[0_8px_24px_rgba(17,24,39,0.08)]',
            align === 'right' ? 'right-0 data-[flip-x]:right-auto data-[flip-x]:left-0' : 'left-0 data-[flip-x]:left-auto data-[flip-x]:right-0',
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
