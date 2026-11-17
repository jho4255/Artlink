import { useState, type ReactNode } from 'react';
import { Heart, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 모집공고 찾기 · 갤러리 찾기가 같이 쓰는 머리·거르기 부품(2026-11-15 개편).
 * 색은 흑백 + 강조색 하나(DESIGN.md) — 고른 것은 밑줄, 알약·칩 모양을 쓰지 않는다.
 */

/**
 * 화면 머리 — 영문 제목 + 검색 + (갤러리 계정이면) 등록 단추.
 * PC 는 제목 줄 오른쪽에 밑줄 입력칸 · 휴대폰은 돋보기 단추를 누르면 제목 아래 칸이 열린다(검색어가 걸려 있으면 늘 열려 있다 —
 * 무엇으로 거른 목록인지 보여야 한다). 설명 문구는 두지 않는다.
 */
export function ListHeader({ title, placeholder, applied, onApply, action, wide, searchLabel }: {
  title: string;
  placeholder: string;
  /** 지금 걸린 검색어(주소의 ?q=) */
  applied: string;
  onApply: (q: string) => void;
  /** 제목 줄 오른쪽 끝 — [공모 등록]·[갤러리 등록] */
  action?: ReactNode;
  wide: boolean;
  /** 휴대폰 돋보기 단추 이름 — '공모 검색' */
  searchLabel: string;
}) {
  const [text, setText] = useState(applied);
  const [open, setOpen] = useState(false);
  // 뒤로 가기 등으로 주소의 검색어가 바뀌면 입력칸도 따라간다(렌더 중 상태 맞추기 — effect 안 setState 금지)
  const [prevApplied, setPrevApplied] = useState(applied);
  if (prevApplied !== applied) { setPrevApplied(applied); setText(applied); }

  const submit = (e: React.FormEvent) => { e.preventDefault(); onApply(text.trim()); };
  const clear = () => { setText(''); onApply(''); setOpen(false); };

  const box = (
    <form role="search" onSubmit={submit} className={cn('relative flex items-center', wide ? 'w-[320px] max-w-full' : 'mt-4 w-full')}>
      <Search size={17} aria-hidden className="pointer-events-none absolute left-0 text-gray-500" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={!wide && open && !applied}
        enterKeyHint="search"
        className="h-11 w-full border-0 border-b border-gray-900 bg-transparent pl-7 pr-9 text-[15px] text-gray-900 placeholder:text-gray-500 focus:outline-none"
      />
      {text && (
        <button type="button" onClick={clear} aria-label="검색어 지우기" className="absolute right-0 grid h-11 w-9 place-items-center text-gray-500 hover:text-gray-900">
          <X size={16} aria-hidden />
        </button>
      )}
    </form>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[34px] font-serif leading-tight text-gray-900 md:text-5xl">{title}</h1>
        <div className="flex items-center gap-3">
          {wide ? box : !(open || applied) && (
            <button type="button" onClick={() => setOpen(true)} aria-label={searchLabel} className="-mr-2 grid h-11 w-11 place-items-center text-gray-900">
              <Search size={21} aria-hidden />
            </button>
          )}
          {action}
        </div>
      </div>
      {!wide && (open || applied) && box}
    </div>
  );
}

/** 글자 단추 하나 — 고르면 진하게 + 밑줄. 누르는 자리는 44px */
export function ChoiceButton({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap transition-colors',
        on ? 'text-gray-900 underline decoration-1 underline-offset-[6px]' : 'text-gray-500 hover:text-gray-900',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** 이름표 + [전체] + 값들 — PC 의 지역·유형 줄 */
export function ChoiceGroup({ label, options, value, onChange, nameOf }: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  nameOf: (v: string) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-x-5">
      <span className="mr-1 text-[13px] font-semibold text-gray-700" aria-hidden="true">{label}</span>
      <ChoiceButton on={!value} onClick={() => onChange(null)}>전체</ChoiceButton>
      {options.map((o) => (
        <ChoiceButton key={o} on={value === o} onClick={() => onChange(value === o ? null : o)}>{nameOf(o)}</ChoiceButton>
      ))}
    </div>
  );
}

/** 찜 하트 — 활성은 강조색. 이름은 '찜하기'/'찜 해제'(E2E·화면 낭독기가 이 이름으로 찾는다) */
export function HeartButton({ on, onToggle, size = 18, className }: { on: boolean; onToggle: () => void; size?: number; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      aria-label={on ? '찜 해제' : '찜하기'}
      className={cn('grid h-11 w-11 shrink-0 cursor-pointer place-items-center', className)}
    >
      <Heart size={size} aria-hidden className={on ? 'fill-accent text-accent' : 'text-gray-400 hover:text-gray-600'} />
    </button>
  );
}
