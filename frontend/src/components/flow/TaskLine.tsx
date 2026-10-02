import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChipVariant } from '@/lib/flowLabels';

/**
 * '지금 할 일' 한 줄 — 누르면 그 일을 하는 자리로 데려간다
 * (2026-09-29 갤러리·작가 전시 카드, 2026-10-02 홈페이지 편집 화면이 함께 쓰려고 MyPage 에서 꺼냈다).
 *
 *  - attention : 지금 해야 하는 것 — 옅은 빨강 판 + 빨강 점
 *  - neutral   : 알아 두면 되는 것 — 옅은 회색 판
 *  - done      : 끝난 것
 *
 * `onClick`(그 화면 안에서 구역을 연다) 또는 `to`(다른 화면으로 간다 — 링크) 중 하나를 준다.
 * 둘 다 없으면 글만 보이는 줄이다(갈 곳이 없는 할 일 — 승인 대기 등).
 * 위쪽 여백은 `className` 으로 바꾼다(기본 `mt-4` — 카드 안에서 쓰던 값).
 */
export interface TaskLineTask {
  text: string;
  tone: ChipVariant;
  /** 줄 끝 바로가기 이름(없으면 화살표만) */
  action?: string;
}

export default function TaskLine({ task, onClick, to, className = 'mt-4' }: {
  task: TaskLineTask;
  onClick?: () => void;
  /** 다른 화면으로 가는 줄이면 주소 — 버튼이 아니라 링크로 그린다 */
  to?: string;
  className?: string;
}) {
  const tone = task.tone;
  const body = (
    <>
      <span aria-hidden className={cn('mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full', tone === 'attention' ? 'bg-accent' : tone === 'done' ? 'bg-gray-300' : 'bg-gray-400')} />
      <span className={cn('min-w-0 flex-1 break-keep text-sm leading-relaxed', tone === 'attention' ? 'font-medium text-gray-950' : 'text-gray-600')}>{task.text}</span>
      {(onClick || to) && (
        <span className="inline-flex shrink-0 items-center gap-0.5 self-center text-sm font-medium text-gray-900">
          {task.action}<ArrowRight size={14} aria-hidden />
        </span>
      )}
    </>
  );
  const cls = cn('flex w-full items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-left', tone === 'attention' ? 'bg-accent/5' : 'bg-gray-50', className);
  // data-task-line — E2E 가 카드 높이를 잴 때 이 줄을 뺀다(할 일이 있는 카드만 한 줄 높다. 그건 들쭉날쭉이 아니라 정보다)
  if (to) return <Link to={to} data-task-line className={cn(cls, 'transition-colors hover:bg-gray-100')}>{body}</Link>;
  return onClick
    ? <button type="button" data-task-line onClick={onClick} className={cn(cls, 'transition-colors hover:bg-gray-100')}>{body}</button>
    : <div data-task-line className={cls}>{body}</div>;
}
