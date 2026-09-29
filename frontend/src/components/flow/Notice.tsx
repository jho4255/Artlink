import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 안내 상자 — 공모 흐름 화면 공통 (2026-09-29). 두 가지뿐이다.
 *  - neutral   : 알아 두면 되는 것(잠긴 이유, 자동 정리 예고, 선정까지만 진행하는 공고 …) — 옅은 회색 판
 *  - attention : 지금 해야 하는 것 — 옅은 빨강 판 + 빨강 제목
 * 파랑(잠김)·노랑(요청 중)·초록(완료)·오렌지(할 일) 상자를 섞어 쓰던 것을 접었다.
 */
export default function Notice({ tone = 'neutral', title, children, action, className }: {
  tone?: 'neutral' | 'attention';
  title?: ReactNode;
  children?: ReactNode;
  /** 오른쪽(좁은 화면에선 아래) 버튼 자리 */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        tone === 'attention' ? 'border border-accent/20 bg-accent/5' : 'bg-gray-50',
        className,
      )}
    >
      <div className="min-w-0 text-sm leading-relaxed">
        {title && <p className={cn('font-medium', tone === 'attention' ? 'text-accent' : 'text-gray-900')}>{title}</p>}
        {children && <div className={cn('text-gray-600', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
