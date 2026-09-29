import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 단계 표시 — 공모 흐름 화면 공통 (2026-09-29).
 *
 * `current` 는 **지금 하고 있는(또는 다음에 할) 단계의 번호**(0부터). 그 앞은 끝난 단계, `current === steps.length`
 * 이면 전부 끝. 예전 운영 화면 스텝퍼와 같은 규칙이고, 색만 뺐다(끝난 단계 초록 → 검정 ✓).
 *
 *  - `nodes`  : 동그라미 + 선. 운영 화면의 진행 단계·정산 단계
 *  - `inline` : 글자 흐름 `등록 요청 → 관리자 승인 → …`. 공모 등록 폼 맨 위의 '전체 순서' 처럼 단계가 많을 때
 *               (7개를 동그라미로 그리면 휴대폰에서 글자가 겹친다)
 */
export default function ProgressSteps({ steps, current, variant = 'nodes', label, className }: {
  steps: string[];
  current: number;
  variant?: 'nodes' | 'inline';
  /** 스크린리더용 이름 */
  label: string;
  className?: string;
}) {
  const stateOf = (i: number) => (i < current ? 'done' : i === current ? 'current' : 'todo');

  if (variant === 'inline') {
    return (
      <ol aria-label={label} className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs', className)}>
        {steps.map((s, i) => {
          const st = stateOf(i);
          return (
            <Fragment key={s}>
              {i > 0 && <li aria-hidden className="text-gray-300">→</li>}
              <li
                aria-current={st === 'current' ? 'step' : undefined}
                className={cn('whitespace-nowrap', st === 'current' ? 'font-semibold text-gray-900' : st === 'done' ? 'text-gray-500' : 'text-gray-400')}
              >
                {s}
              </li>
            </Fragment>
          );
        })}
      </ol>
    );
  }

  return (
    <ol aria-label={label} className={cn('flex items-start', className)}>
      {steps.map((s, i) => {
        const st = stateOf(i);
        return (
          <li key={s} className="flex flex-1 items-start last:flex-none" aria-current={st === 'current' ? 'step' : undefined}>
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums',
                  st === 'done' && 'bg-gray-900 text-white',
                  st === 'current' && 'bg-white text-gray-900 ring-2 ring-inset ring-gray-900',
                  st === 'todo' && 'bg-gray-100 text-gray-400',
                )}
              >
                {st === 'done' ? <Check size={14} strokeWidth={2.5} aria-label="완료" /> : i + 1}
              </span>
              <span className={cn('whitespace-nowrap text-xs', st === 'todo' ? 'text-gray-400' : st === 'current' ? 'font-semibold text-gray-900' : 'text-gray-700')}>
                {s}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span aria-hidden className={cn('mx-2 mt-3.5 h-px min-w-3 flex-1', i < current ? 'bg-gray-900' : 'bg-gray-200')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
