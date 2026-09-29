import { cn } from '@/lib/utils';

/**
 * 긴 입력 화면(공모 등록 폼 · 지원서 페이지)의 입력칸 모양 — 한 곳 (2026-09-29).
 * 컴포넌트 파일(`components/flow/FormParts.tsx`)에 두면 fast-refresh 가 그 파일을 통째로 새로 고쳐 입력 중이던 값이 날아간다.
 */
export const formInputCls = (bad?: boolean) => cn(
  'w-full rounded-lg border bg-white px-3 py-2.5 text-sm focus:outline-none',
  bad ? 'border-accent bg-accent/5' : 'border-gray-200 focus:border-gray-400',
);
