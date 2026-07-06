import { Eye } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

/**
 * 상세 페이지 조회수 배지 — ADMIN 계정에게만 노출.
 * 관리자·소유자 본인 조회는 집계에서 제외된 누적 조회수를 표시한다(백엔드 lib/viewCount).
 */
export default function ViewCountBadge({ count, className = '' }: { count?: number; className?: string }) {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'ADMIN' || count == null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-medium text-white ${className}`}
      title="상세 페이지 조회수 (관리자에게만 표시)"
    >
      <Eye size={13} />
      <span className="tabular-nums">{count.toLocaleString('ko')}</span>
      <span className="text-gray-300">조회</span>
    </span>
  );
}
