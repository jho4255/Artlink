import { cn } from '@/lib/utils';
import type { StripCell } from '@/lib/flowLabels';

/**
 * 진행 띠 — 공모 흐름의 다섯 칸(모집 · 전시 준비 · 전시 · 정산 · 마무리)을 갤러리·작가가 같이 본다 (2026-11-20, 규칙 88).
 * 모양은 모집공고 상세의 일정 띠(`components/exhibition/DetailBits.tsx ScheduleStrip`)와 같은 결 — 위 2px 선 + 작은 이름 + 값.
 * 예전엔 갤러리 카드의 통계 4칸 · 운영 탭의 동그라미 4칸 · 정산 안의 동그라미 3칸 · 작가 카드의 일정 줄이 같은 것을 네 가지로 그렸다.
 *
 *  - `full` : 공모 한 건 화면 — 이름 · 값 · 날짜
 *  - `row`  : 목록 줄(넓은 화면) — 이름 · 값 한 줄
 *  - `bar`  : 목록 줄(휴대폰) — 선과 이름만
 *
 * 칸 판정은 `lib/flowLabels.ts flowStrip` 하나 — 여기서는 그리기만 한다.
 */
export default function FlowStrip({ cells, variant = 'full', className }: {
  cells: StripCell[];
  variant?: 'full' | 'row' | 'bar';
  className?: string;
}) {
  const cols = cells.length;
  return (
    <ol
      aria-label="진행 단계"
      className={cn('grid', variant === 'full' ? 'gap-x-3 gap-y-4' : variant === 'row' ? 'gap-x-2' : 'gap-x-1.5', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cells.map((c) => {
        const on = c.state !== 'todo';
        const cur = c.state === 'current';
        return (
          <li
            key={c.key}
            aria-current={cur ? 'step' : undefined}
            data-state={c.state}
            className={cn('min-w-0 border-t-2', on ? 'border-gray-900' : 'border-gray-200', variant === 'full' ? 'pt-2.5' : variant === 'row' ? 'pt-[7px]' : 'pt-1.5')}
          >
            <p className={cn(
              'truncate',
              variant === 'bar' ? 'text-[11.5px]' : variant === 'row' ? 'text-xs' : 'text-[13px]',
              cur ? 'font-bold text-gray-950' : 'text-gray-500',
            )}>
              {c.label}
              {c.state === 'done' && <span className="sr-only"> (끝남)</span>}
            </p>
            {variant !== 'bar' && c.value && (
              <p className={cn(
                'mt-0.5 truncate tabular-nums',
                variant === 'row' ? 'text-[12.5px]' : 'text-[15px]',
                cur ? 'font-medium text-gray-950' : c.state === 'done' ? 'text-gray-500' : 'text-gray-600',
              )}>
                {c.value}
              </p>
            )}
            {variant === 'full' && c.note && (
              <p className={cn('mt-0.5 truncate text-[12.5px] tabular-nums', c.hot ? 'font-semibold text-accent' : 'text-gray-500')}>{c.note}</p>
            )}
            {variant === 'row' && c.hot && c.note && (
              <p className="mt-0.5 truncate text-[12px] font-semibold tabular-nums text-accent">{c.note}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
