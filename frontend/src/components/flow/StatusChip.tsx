import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChipVariant } from '@/lib/flowLabels';

/**
 * 상태 칩 — 공모 흐름 화면(내 공모·지원자·출품 자료·정산·내 전시) 공통 (2026-09-29).
 *
 * 색은 셋뿐이다. neutral(흑백) · attention(빨강 = 지금 누군가 할 일) · done(✓ 와 옅은 회색).
 * 예전엔 단계마다 파랑·노랑·보라·초록·남색 배지를 달리해서, 한 카드에 색이 넷씩 붙고 무엇이 급한지 안 보였다.
 * 이름은 `lib/flowLabels.ts` 에서 받는다 — 여기서 글자를 만들지 말 것.
 */
export default function StatusChip({ variant = 'neutral', children, className }: {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // shrink-0 + nowrap — 좁은 화면에서 '대 기 중' 처럼 세로로 쪼개지지 않게(규칙 27)
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5',
        variant === 'neutral' && 'border-gray-200 bg-white text-gray-700',
        variant === 'attention' && 'border-accent/25 bg-accent/5 text-accent',
        variant === 'done' && 'border-gray-200 bg-gray-50 text-gray-500',
        className,
      )}
    >
      {variant === 'done' && <Check size={12} strokeWidth={2.5} aria-hidden />}
      {children}
    </span>
  );
}
