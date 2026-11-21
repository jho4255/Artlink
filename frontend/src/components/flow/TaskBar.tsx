import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ChipVariant } from '@/lib/flowLabels';

/**
 * 할 일 줄 — 공모 한 건 화면의 진행 띠 바로 아래 (2026-11-20, 규칙 88).
 * 위아래 가는 선 사이 한 줄: 점(지금 할 일이면 빨강) + 문장 · 오른쪽에 **진짜 버튼**(검정 주 버튼 하나 + 테두리 보조).
 * 예전 할 일 줄(`TaskLine`)은 분홍 판 위에서 그 구역으로 '데려가기'만 했다 — 버튼을 한 번 더 찾아 눌러야 했다.
 *
 * 휴대폰(`stacked`)은 문장 아래로 버튼이 내려간다. 버튼 자리는 부르는 쪽이 정한다(`actions`) — 정산은 정산 탭의 상태를 아는
 * 컨트롤러가 버튼을 정한다(`useSettlementController`).
 */
export default function TaskBar({ text, tone, actions, className }: {
  text: ReactNode;
  tone: ChipVariant;
  /** 오른쪽 버튼들(TaskButton) */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-task-bar
      className={cn('flex flex-col gap-3 border-y border-gray-200 py-3.5 sm:min-h-[64px] sm:flex-row sm:items-center sm:justify-between sm:gap-4', className)}
    >
      <p className={cn('flex min-w-0 items-start gap-2.5 break-keep text-[15px] leading-relaxed [overflow-wrap:anywhere]', tone === 'attention' ? 'font-medium text-gray-950' : 'text-gray-600')}>
        <span
          aria-hidden
          className={cn('mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full', tone === 'attention' ? 'bg-accent' : tone === 'done' ? 'bg-gray-300' : 'bg-gray-400')}
        />
        <span className="min-w-0">{text}</span>
      </p>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 할 일 줄의 버튼 — 주 버튼(검정) 하나 · 보조(테두리) */
export function TaskButton({ kind = 'primary', onClick, disabled, busy, children, className }: {
  kind?: 'primary' | 'secondary';
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  // 연타 한 번은 한 번으로 — '처리 중' 표시(busy)는 요청이 시작된 다음 렌더에야 그려져서, 그 사이 두 번째 클릭이
  // 같은 요청을 또 보냈다(2026-11-20 신뢰성 점검 S12). 같은 버튼을 0.4초 안에 다시 누르면 무시한다.
  // ⚠️ 더 길게 잡지 말 것 — 서버가 바로 실패했을 때 다시 누르는 손까지 막는다(0.8초에서 E2E 87 실패 주입이 잡았다)
  const last = useRef(0);
  const click = () => {
    const now = Date.now();
    if (now - last.current < 400) return;
    last.current = now;
    onClick();
  };
  return (
    <button
      type="button"
      onClick={click}
      disabled={disabled || busy}
      className={cn(
        'inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm disabled:opacity-40',
        kind === 'primary' ? 'bg-gray-900 font-semibold text-white hover:bg-gray-800' : 'border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50',
        className,
      )}
    >
      {busy ? '처리 중…' : children}
    </button>
  );
}
