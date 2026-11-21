import { cn } from '@/lib/utils';

/** 메뉴 옆 처리할 일 수(관리자, 2026-11-21) — 강조색 알약 하나. 99 를 넘으면 99+ */
export default function MenuBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-white', className)}
      aria-label={`처리할 일 ${count}건`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
