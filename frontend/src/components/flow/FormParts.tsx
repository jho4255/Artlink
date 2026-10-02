import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 긴 입력 화면의 뼈대 — 공모 등록 폼 · 지원서 페이지가 같이 쓴다 (2026-09-29).
 *
 * 둘 다 예전엔 칸이 한 덩어리로 이어져 어디까지가 한 묶음인지, 무엇이 필수인지가 안 보였다.
 * 번호 붙은 구역(1 진행 범위 · 2 공고 내용 …)으로 나누고, 칸마다 **그 칸이 무엇을 일으키는지**를 한 줄 적는다.
 */
export function FormSection({ n, title, description, children, id }: {
  n: number;
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-gray-100 pt-6">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="w-4 shrink-0 text-sm font-semibold tabular-nums text-gray-300">{n}</span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-950">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      <div className="sm:pl-7">{children}</div>
    </section>
  );
}

/** 한 칸 — 라벨 · 입력 · 설명(무엇이 일어나는지). `error` 면 라벨이 빨개진다 */
export function FormField({ label, hint, error, htmlFor, className, children }: {
  label: string;
  hint?: ReactNode;
  error?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium', error ? 'text-accent' : 'text-gray-800')}>{label}</label>
      {children}
      {hint && <p className="mt-1.5 break-keep text-xs leading-relaxed text-gray-500">{hint}</p>}
    </div>
  );
}
