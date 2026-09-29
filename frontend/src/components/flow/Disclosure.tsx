import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 접었다 펴는 구역 — 공모 흐름 화면 공통 (2026-09-29).
 *
 *  - `section` : 운영 화면·작가 전시 카드의 구역 머리(운영 공지 · 출품 자료 · 정산). 제목 + 요약(meta) + ⌄
 *  - `link`    : 드물게 쓰는 입구를 한 줄로 접어 둘 때(초대 코드). 예전엔 이 상자들이 화면 **맨 위**를 차지해
 *                처음 온 사람이 "이걸 먼저 해야 하나?" 로 읽었다.
 *
 * 한 번 펼친 내용은 접어도 **언마운트하지 않는다** — 출품작 다섯 점을 입력하다 머리말을 눌러 접으면 폼 state 가
 * 통째로 사라졌다(2026-09-19, 옛 ArtistOperationPanel 의 Block 에서 겪은 일을 그대로 옮겼다).
 * 처음부터 전부 마운트하지도 않는다 — 구역마다 쿼리를 돈다.
 *
 * `open` 을 주면 부모가 연다/닫는다(카드의 '다음 할 일' 을 누르면 그 구역이 열려야 해서).
 */
export default function Disclosure({
  title, meta, hint, variant = 'section', defaultOpen = false, open: openProp, onOpenChange, openSignal, disabled, children, id, className,
}: {
  title: ReactNode;
  /** 제목 옆 요약 — '2건', '1/3 제출' */
  meta?: ReactNode;
  /** 제목 옆 빨간 한마디 — 접혀 있어도 할 일이 보여야 한다('제출 필요') */
  hint?: ReactNode;
  variant?: 'section' | 'link';
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * 값이 바뀔 때마다 한 번 연다(닫는 건 여전히 사용자 마음) — 카드의 할 일 줄을 눌렀을 때.
   * `open` 으로 고정하면 그 뒤로 접을 수가 없다.
   */
  openSignal?: number | null;
  /** 아직 열 수 없는 구역(정산은 전시 종료 뒤) — 이유를 meta 로 적는다 */
  disabled?: boolean;
  children?: ReactNode;
  /** 스크롤해 올 목적지 id */
  id?: string;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const [lastSignal, setLastSignal] = useState(openSignal);
  // 렌더 중 상태 맞추기(effect 안 setState 대신, PosterImage 와 같은 방식)
  if (openSignal != null && openSignal !== lastSignal) { setLastSignal(openSignal); setInner(true); }
  const open = openProp ?? inner;
  const [mounted, setMounted] = useState(open);
  // 부모가 열었을 때도 마운트
  if (open && !mounted) setMounted(true);
  const panelId = useId();

  const toggle = () => {
    if (disabled) return;
    const next = !open;
    if (next) setMounted(true);
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  };

  if (variant === 'link') {
    return (
      <div id={id} className={cn('scroll-mt-24', className)}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-[40px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          {title}
          {meta && <span className="text-gray-400">· {meta}</span>}
          <ChevronDown size={14} className={cn('shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        {mounted && <div id={panelId} className={open ? 'pt-2' : 'hidden'}>{children}</div>}
      </div>
    );
  }

  return (
    <section id={id} className={cn('scroll-mt-24', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-disabled={disabled || undefined}
        className={cn('flex min-h-[52px] w-full items-center gap-3 py-3 text-left', disabled ? 'cursor-default' : 'group cursor-pointer')}
      >
        <span className={cn('text-base font-semibold', disabled ? 'text-gray-400' : 'text-gray-950')}>{title}</span>
        {meta && <span className="min-w-0 truncate text-sm text-gray-500">{meta}</span>}
        {hint && <span className="shrink-0 whitespace-nowrap text-xs font-medium text-accent">{hint}</span>}
        {!disabled && (
          <ChevronDown size={16} aria-hidden className={cn('ml-auto shrink-0 text-gray-400 transition-transform group-hover:text-gray-700', open && 'rotate-180')} />
        )}
      </button>
      {mounted && <div id={panelId} className={open ? 'pb-5' : 'hidden'}>{children}</div>}
    </section>
  );
}
