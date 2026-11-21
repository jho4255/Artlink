import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import type { AdminBadgeKey } from '@/lib/myPageMenu';

/**
 * 관리자의 처리할 일 수(2026-11-21, 규칙 89) — 메뉴 배지(사이드바 · 휴대폰 [메뉴] · 마이페이지 가로 탭)와
 * [통계] 요약의 '지금 처리할 일' 이 같은 값을 쓴다. 서버 `GET /admin/todo-counts`(lib/adminConsole.ts).
 * 관리자가 아니면 부르지 않는다. 1분마다 다시 받는다(배지라 늦어도 괜찮다 — 처리하는 화면은 직접 무효화한다).
 */
export interface AdminTodoCounts {
  approvals: number;
  approvalsByKind: { gallery: number; exhibition: number; show: number; edit: number; delete: number };
  reports: number;
  reportsByKind: { chat: number; story: number };
  inquiries: number;
  oldestInquiryAt: string | null;
  pendingApplications: number;
  closingSoon: number;
  closingSoonEmpty: number;
  stalled: number;
}

export const ADMIN_TODO_KEY = ['admin-todo-counts'] as const;

export function useAdminTodo() {
  const role = useAuthStore((s) => s.user?.role);
  return useQuery<AdminTodoCounts>({
    queryKey: ADMIN_TODO_KEY,
    queryFn: () => api.get('/admin/todo-counts').then((r) => r.data),
    enabled: role === 'ADMIN',
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** 메뉴 배지 숫자 — 0 이면 null(배지를 그리지 않는다) */
export function badgeCount(counts: AdminTodoCounts | undefined, key: AdminBadgeKey | undefined): number | null {
  if (!counts || !key) return null;
  const n = counts[key];
  return n > 0 ? n : null;
}
