import { Eye } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

/**
 * 상세 페이지 조회수 배지 — 기본은 ADMIN 계정에게만 노출.
 * 관리자·소유자 본인 조회는 집계에서 제외된 누적 조회수를 표시한다(백엔드 lib/viewCount).
 *
 * `owner` — 공모 상세처럼 **서버가 볼 수 있는 사람에게만 조회수를 싣는** 화면(2026-10-05: 공모를 올린 갤러리도 본다).
 * 그때는 값이 왔으면 그린다. 갤러리·전시 상세는 아직 누구에게나 값이 실리므로 관리자 판정을 그대로 둔다.
 */
export default function ViewCountBadge({ count, className = '', owner = false }: { count?: number | null; className?: string; owner?: boolean }) {
  const user = useAuthStore((s) => s.user);
  if (count == null) return null;
  const isAdmin = user?.role === 'ADMIN';
  if (!isAdmin && !owner) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-medium text-white ${className}`}
      title={owner ? '상세 페이지 조회수 — 이 공모를 올린 갤러리와 관리자에게만 보여요(올린 갤러리·관리자의 조회는 세지 않아요)' : '상세 페이지 조회수 (관리자에게만 표시)'}
    >
      <Eye size={13} />
      <span className="tabular-nums">{count.toLocaleString('ko')}</span>
      <span className="text-gray-300">조회</span>
    </span>
  );
}
