import { useRef, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChipVariant, StripCell } from '@/lib/flowLabels';
import FlowStrip from '@/components/flow/FlowStrip';
import Thumb from '@/components/shared/Thumb';

/**
 * 공모 한 줄 — 갤러리 [내 공모] · 작가 [내 전시] 목록이 같이 쓴다 (2026-11-20, 규칙 88).
 * 예전 카드(통계 4칸 · 일정 줄 · 안쪽 탭 · 접기)는 정산 중인 것 하나가 휴대폰 2,485px 였다. 지금은 줄 하나:
 *
 *   PC     [포스터] 상태 · 보조          | ● 지금 할 일
 *                  제목 · 갤러리/유형     |        [주 버튼]
 *                  진행 띠(이름 + 값)     |
 *   휴대폰 [포스터] 상태 · 보조 / 제목 / 갤러리
 *          진행 띠(선 + 이름)
 *          ● 지금 할 일 ·········· 버튼 →
 *
 * 누르면 그 공모 한 건 화면이 열린다(`onOpen`). 버튼은 **그 자리에서 실행하지 않는다** — 그 화면으로 데려가고,
 * 확인이 필요한 일이면 도착해서 확인창을 연다(`onAction` — 무엇에 대한 확인인지 화면이 보여 준 뒤에).
 * 줄 id(`ex-card-<id>` · `app-card-<id>`)는 E2E·딥링크가 쓴다.
 */
export default function ExhibitionRow({ id, wide, poster, status, sub, title, meta, strip, task, actionLabel, mobileActionLabel, onOpen, onAction, children }: {
  id: string;
  /** 넓은 화면(PC 배치) — 부르는 쪽이 한 번 재서 넘긴다 */
  wide: boolean;
  poster?: string | null;
  status: ReactNode;
  sub?: ReactNode;
  title: string;
  meta?: ReactNode;
  strip: StripCell[];
  /** 지금 할 일 — 없으면(기다리는 줄) 휴대폰은 할 일 줄을 그리지 않는다 */
  task?: { text: string; tone: ChipVariant } | null;
  /** 주 버튼 이름 — 있으면 버튼을 그린다(할 일이 있는 줄) */
  actionLabel?: string;
  /** 휴대폰 할 일 줄 끝의 짧은 이름(없으면 actionLabel) */
  mobileActionLabel?: string;
  onOpen: () => void;
  onAction?: () => void;
  /** 줄 안에 덧붙일 것 — 반려 사유·삭제 요청 줄 */
  children?: ReactNode;
}) {
  // 연타 — 두 번 톡 치면 요청·이동이 두 번 갔다(작가 미선정 [확인] 이 요청 두 번 · 2026-11-21 e2e 90 ART-03).
  // 할 일 버튼(TaskButton)과 같은 0.4초 — 누른 뒤 무엇이 일어났는지 보고 다시 누르는 데는 충분하다
  const lastAct = useRef(0);
  const act = () => {
    const now = Date.now();
    if (now - lastAct.current < 400) return;
    lastAct.current = now;
    onAction?.();
  };
  const attention = task?.tone === 'attention';
  const dot = <span aria-hidden className={cn('mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle', attention ? 'bg-accent' : 'bg-gray-400')} />;
  const posterBox = (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onOpen}
      className={cn('block shrink-0 bg-gray-50', wide ? 'h-[119px] w-[84px]' : 'h-[79px] w-14')}
    >
      {poster && <Thumb src={poster} alt="" className="h-full w-full object-contain" />}
    </button>
  );
  const head = (
    <>
      <p className={cn('flex flex-wrap items-center gap-x-2 text-gray-600', wide ? 'text-[13px]' : 'text-[12.5px]')}>
        <strong className="font-bold text-gray-950">{status}</strong>
        {sub && <span className="tabular-nums">{sub}</span>}
      </p>
      <h3 className={cn('mt-1 font-semibold leading-snug tracking-tight text-gray-950', wide ? 'text-[19px]' : 'text-[16.5px]')}>
        <button type="button" onClick={onOpen} className="break-keep text-left [overflow-wrap:anywhere] hover:underline underline-offset-4">{title}</button>
      </h3>
      {meta && <p className="mt-0.5 truncate text-[13px] text-gray-500">{meta}</p>}
    </>
  );

  if (wide) {
    return (
      <li id={id} data-exhibition-row className="grid scroll-mt-24 grid-cols-[84px_minmax(0,1fr)_232px] gap-6 border-b border-gray-200 py-6">
        {posterBox}
        <div className="min-w-0">
          {head}
          {children}
          <FlowStrip cells={strip} variant="row" className="mt-4" />
        </div>
        <div className="flex min-w-0 flex-col items-end justify-between gap-3 text-right">
          {task && (
            <p className={cn('mt-0.5 break-keep text-sm leading-relaxed [overflow-wrap:anywhere]', attention ? 'font-medium text-gray-950' : 'text-gray-600')}>
              {attention && dot}{task.text}
            </p>
          )}
          {actionLabel && onAction && (
            <button type="button" onClick={act} className="inline-flex min-h-[44px] max-w-full items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800">
              <span className="truncate">{actionLabel}</span>
            </button>
          )}
        </div>
      </li>
    );
  }

  // 휴대폰 — 포스터·상태·제목을 한 단추로(제목 글자만 누르게 하면 누르는 곳이 23px 였다)
  return (
    <li id={id} data-exhibition-row className={cn('scroll-mt-24 border-b border-gray-200', actionLabel && onAction ? 'pt-[18px]' : 'py-[18px]')}>
      <button type="button" onClick={onOpen} className="flex w-full gap-3.5 text-left">
        <span className="block h-[79px] w-14 shrink-0 bg-gray-50" aria-hidden>
          {poster && <Thumb src={poster} alt="" className="h-full w-full object-contain" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-gray-600">
            <strong className="font-bold text-gray-950">{status}</strong>
            {sub && <span className="tabular-nums">{sub}</span>}
          </span>
          <span className="mt-1 block break-keep text-[16.5px] font-semibold leading-snug tracking-tight text-gray-950 [overflow-wrap:anywhere]">{title}</span>
          {meta && <span className="mt-0.5 block truncate text-[13px] text-gray-500">{meta}</span>}
        </span>
      </button>
      {children}
      <FlowStrip cells={strip} variant="bar" className="mt-3.5" />
      {task && actionLabel && onAction && (
        <button
          type="button"
          onClick={act}
          className="mt-2.5 flex min-h-[50px] w-full items-center justify-between gap-2.5 border-t border-gray-100 text-left"
        >
          <span className={cn('min-w-0 break-keep text-sm [overflow-wrap:anywhere]', attention ? 'font-medium text-gray-950' : 'text-gray-600')}>{dot}{task.text}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-gray-950">{mobileActionLabel ?? actionLabel}<ArrowRight size={14} aria-hidden /></span>
        </button>
      )}
    </li>
  );
}

/** 묶음 머리 — '지금 할 일 5' · '기다리는 중 2' (모집공고 목록의 묶음 머리와 같은 모양) */
export function RowGroupHead({ label, count, first = false }: { label: string; count: number; first?: boolean }) {
  return (
    <h2 className={cn('border-b-2 border-gray-900 pb-2.5 text-[13.5px] font-semibold text-gray-950 sm:text-sm', first ? 'mt-6' : 'mt-9')}>
      {label} <span className="font-normal text-gray-500">{count}</span>
    </h2>
  );
}
