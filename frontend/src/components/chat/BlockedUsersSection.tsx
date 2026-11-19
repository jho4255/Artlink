import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { chatRoleTag } from '@/lib/chatView';
import { chatsChanged } from '@/lib/chatCache';

/**
 * 프로필 탭 맨 아래 — ArtTalk 에서 차단한 사람과 [차단 풀기] (2026-11-19). 차단한 사람이 없으면 아무것도 그리지 않는다.
 * 차단하면 그 사람과의 1:1 방이 내 목록에서 빠지므로, 다시 찾아갈 곳이 여기다.
 */
interface Blocked { id: number; name: string; role: string; deleted: boolean; blockedAt: string }

export default function BlockedUsersSection() {
  const qc = useQueryClient();
  const { data = [] } = useQuery<Blocked[]>({
    queryKey: ['blocks'],
    queryFn: () => api.get('/blocks').then((r) => r.data),
  });
  const unblock = useMutation({
    mutationFn: (id: number) => api.delete(`/blocks/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['blocks'] });
      chatsChanged(qc);
      toast.success('차단을 풀었어요.');
    },
    onError: () => toast.error('차단을 풀지 못했어요.'),
  });
  if (data.length === 0) return null;
  return (
    <section aria-labelledby="blocked-title" className="mt-10 border-t border-gray-200 pt-6" data-testid="blocked-users">
      <h2 id="blocked-title" className="text-base font-bold text-gray-900">차단한 사람</h2>
      <ul className="mt-3 divide-y divide-gray-100">
        {data.map((b) => (
          <li key={b.id} className="flex min-h-[52px] items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[15px] text-gray-900">{b.name}</span>
            <span className="shrink-0 text-xs text-gray-600">{b.deleted ? '탈퇴' : chatRoleTag(b.role)}</span>
            <button
              type="button"
              disabled={unblock.isPending}
              onClick={() => unblock.mutate(b.id)}
              className="min-h-[40px] shrink-0 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            >
              차단 풀기
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
