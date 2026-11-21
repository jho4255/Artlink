/**
 * 관리자 화면 공용 부품(2026-11-21 개편, CLAUDE.md 규칙 89).
 *
 * 승인 관리 · 주최 공모 · 사용자 관리 · 운영 조회 · 통계가 같은 모양을 쓴다 — 머리 · 글자 단추 거르기 · 찾기 칸 ·
 * **목록 | 한 건**(넓은 화면은 옆 칸, 그 아래는 화면을 덮는 창) · 숫자 칸.
 * 색은 흑백 + 강조색 하나(규칙 47·59). 알약 탭·초록 버튼·노랑 칩을 쓰지 않는다.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/** 화면 이름 + 오른쪽 단추 */
export function AdminHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[22px] font-semibold tracking-tight text-gray-950">{title}</h2>
      {children}
    </div>
  );
}

/** 강조색 점 — '살펴볼 것' 한 가지 신호 */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent align-middle', className)} />;
}

/** 글자 단추로 고르기(라디오) — 고른 것은 굵게 + 밑줄 */
export function ChoiceLinks<T extends string>({ label, value, onChange, options, className }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; count?: number | null }[];
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm', className)}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cn('min-h-[40px] whitespace-nowrap', on ? 'font-semibold text-gray-950 underline decoration-2 underline-offset-[6px]' : 'text-gray-600 hover:text-gray-950')}
          >
            {o.label}{o.count != null && <span className="ml-1 tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 치는 대로 찾기(0.25초 쉬면) — 이름이 곧 라벨 */
export function SearchBox({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  // 바깥에서 값이 바뀌면(다른 화면에서 찾아 들어옴) 따라간다 — 렌더 중 맞추기(effect 안 setState 금지)
  if (value !== synced) { setSynced(value); setText(value); }
  const fn = useRef(onChange);
  useEffect(() => { fn.current = onChange; });
  useEffect(() => {
    if (text === value) return;
    const t = window.setTimeout(() => fn.current(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text, value]);
  return (
    <label className={cn('flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-300 px-3 focus-within:border-gray-900', className)}>
      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-gray-500 sm:text-sm"
      />
    </label>
  );
}

/** 숫자 칸 — 이름 · 큰 숫자(+단위) · 한 줄 */
export function NumberTile({ label, value, unit, note, sub, hot, className }: {
  label: ReactNode; value: ReactNode; unit?: string; note?: ReactNode; sub?: ReactNode; hot?: boolean; className?: string;
}) {
  return (
    <div className={cn('rounded-[10px] bg-gray-50 p-4', className)}>
      <p className="text-[13px] text-gray-600">{hot && <Dot className="mr-2" />}{label}</p>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-gray-950">
        {value}{unit && <span className="ml-1 text-sm font-medium text-gray-600">{unit}</span>}
      </p>
      {sub && <p className="mt-2 text-[12.5px] tabular-nums text-gray-700">{sub}</p>}
      {note && <p className="mt-0.5 text-[12.5px] text-gray-500">{note}</p>}
    </div>
  );
}

/** 구역 머리 — 굵은 이름 + 옆에 작은 설명 */
export function SectionHead({ title, note, children, id }: { title: string; note?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h3 id={id} className="text-[15px] font-semibold text-gray-950">{title}</h3>
        {note && <span className="text-[12.5px] text-gray-500">{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** 비었을 때 — 한 줄 */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="border-y border-gray-200 py-10 text-center text-sm text-gray-500">{children}</p>;
}

/**
 * 한 건 — 넓은 화면(`wide`)은 목록 옆 칸, 좁은 화면은 화면을 덮는 창(`role="dialog"`, Esc · 앱 뒤로가기로 닫힌다).
 * 창은 뒤 페이지 스크롤을 잠근다.
 */
export function DetailPane({ wide, title, onClose, children, footer }: {
  wide: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 아래 붙는 결정 줄(승인·거절 등) */
  footer?: ReactNode;
}) {
  if (wide) {
    return (
      <aside aria-label={title} className="flex max-h-[calc(100vh-7rem)] min-w-0 flex-col rounded-[10px] border border-gray-200 lg:sticky lg:top-24">
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-gray-200 bg-white">{footer}</div>}
      </aside>
    );
  }
  return <DetailSheet title={title} onClose={onClose} footer={footer}>{children}</DetailSheet>;
}

function DetailSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  useEscapeKey(onClose, { yieldToModal: false });
  // 뒤 목록이 밀리지 않게만 잠근다 — 맨 위로 옮기지 않는다(닫으면 보던 줄로 돌아온다)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-gray-200 pl-1 pr-4">
        <button type="button" onClick={onClose} aria-label="닫기" className="flex h-11 w-11 items-center justify-center text-gray-900"><X size={22} aria-hidden /></button>
        <p id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-gray-950">{title}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">{footer}</div>}
    </div>
  );
}

/** 표 머리줄 칸 */
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <span role="columnheader" className={cn('text-[12.5px] text-gray-500', className)}>{children}</span>;
}
