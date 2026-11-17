/**
 * 공모 상세의 작은 부품 — 상세 화면(`pages/ExhibitionDetailPage.tsx`)과 공모 등록 미리보기가 **같이 쓴다**(2026-11-15).
 * 따로 그리면 등록 화면의 미리보기만 낡는다(옛 갤러리 등록이 그랬다).
 */
import { useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeadlineView, ScheduleStep } from '@/lib/listings';

/** 마감 표시 한 줄 — `D-9 11.24(화)까지`. 7일 안이면 앞 글자가 강조색 */
export function DeadlineText({ dv, className }: { dv: DeadlineView; className?: string }) {
  return (
    <p className={className}>
      <b className={cn('font-bold', dv.hot ? 'text-accent' : dv.state === 'closed' ? 'text-gray-500' : 'text-gray-900')}>{dv.badge}</b>
      {dv.date && <span className="ml-2">{dv.date}</span>}
    </p>
  );
}

/** 일정 띠 한 칸의 윗선 — 다음 단계는 진하게(7일 안 마감이면 강조색), 지난 단계는 옅은 회색 */
function stepBorder(s: ScheduleStep): string {
  if (s.state === 'next') return s.hot ? 'border-accent' : 'border-gray-900';
  return s.state === 'past' ? 'border-gray-300' : 'border-gray-200';
}

/** 일정 띠 — 접수 시작 → 접수 마감 → 출품 자료 제출 → 전시(`lib/listings.ts scheduleSteps`). `compact` 는 미리보기 칸 */
export function ScheduleStrip({ steps, compact = false }: { steps: ScheduleStep[]; compact?: boolean }) {
  return (
    <ol className={cn('grid grid-cols-2 gap-x-3', compact ? 'gap-y-3' : 'gap-y-5 sm:grid-cols-4')}>
      {steps.map((s) => (
        <li key={s.key} className={cn('min-w-0 border-t-2', compact ? 'pt-1.5' : 'pt-2.5', stepBorder(s))}>
          <p className={cn(compact ? 'text-[11px]' : 'text-[12px] lg:text-[13px]', s.state === 'next' ? (s.hot ? 'font-semibold text-accent' : 'font-semibold text-gray-900') : 'text-gray-500')}>
            {s.label}{s.note && ` · ${s.note}`}
          </p>
          <p className={cn('tabular-nums', compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-[15px] lg:text-base', s.state === 'past' ? 'text-gray-500' : 'font-medium text-gray-900')}>{s.date}</p>
        </li>
      ))}
    </ol>
  );
}

/** 모집 내용 한 칸 */
export function Fact({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('min-w-0', compact ? 'py-1.5' : 'py-3')}>
      <dt className={cn('text-gray-500', compact ? 'text-[11px]' : 'text-[12px] lg:text-[13px]')}>{label}</dt>
      <dd className={cn('mt-1 font-medium text-gray-900', compact ? 'text-[13px]' : 'text-[15px] lg:text-base')}>{children}</dd>
    </div>
  );
}

// =============================================
// 포스터 1장 (상세 PC 왼쪽 — 모집공고 상세 · 전시 상세) — 원본 비율 그대로, 화면 높이를 넘지 않게. 누르면 크게(라이트박스).
// 예전의 둥근 모서리·대표색 글로우 그림자는 뺐다(DESIGN.md — 그림자 금지, 갤러리 페이지와 같은 결정)
// =============================================
export function DetailPoster({ src, alt, eager, onOpen }: { src: string; alt: string; eager?: boolean; onOpen: () => void }) {
  // 이미지 유실(404) 시 깨진 아이콘 대신 플레이스홀더 표시
  const [errored, setErrored] = useState(false);
  // src 교체 시 에러 상태 초기화 (렌더 중 상태 조정 패턴 — effect 내 setState 금지)
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) { setPrevSrc(src); setErrored(false); }
  return (
    <button type="button" onClick={onOpen} aria-label={`${alt} 크게 보기`} className="block w-full cursor-zoom-in">
      {errored ? (
        <span className="flex aspect-[210/297] w-full flex-col items-center justify-center gap-1.5 bg-gray-100 text-gray-300">
          <ImageOff size={26} strokeWidth={1.5} aria-hidden />
          <span className="line-clamp-1 px-3 text-center text-[11px] text-gray-500">{alt}</span>
        </span>
      ) : (
        <img src={src} alt={alt} className="mx-auto block h-auto max-h-[calc(100vh-9rem)] w-auto max-w-full" loading={eager ? 'eager' : 'lazy'} onError={() => setErrored(true)} />
      )}
    </button>
  );
}
