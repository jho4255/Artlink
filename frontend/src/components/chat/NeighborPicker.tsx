import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import { chatsChanged } from '@/lib/chatCache';
import { chatRoleTag } from '@/lib/chatView';
import type { ChatPerson } from '@/lib/chatTypes';
import ChatSheet from './ChatSheet';
import { PersonAvatar } from './ChatAvatar';

/**
 * 이웃에게 메시지 — **서로 이웃**(양방향 팔로우)인 사람만 나온다. 임의 검색으로 아무에게나 말을 거는 길이 아니다(설계상 유일한 예외).
 * ⚠️ `retiredApis.test.ts` 의 갠톡 길목 허용 목록에 이 파일이 있다 — 길목을 늘리지 말 것.
 */
export default function NeighborPicker({ onClose, onOpened }: { onClose: () => void; onOpened: (chatId: number) => void }) {
  const qc = useQueryClient();
  const { data: mutuals = [], isLoading } = useQuery<ChatPerson[]>({
    queryKey: ['mutuals'],
    queryFn: () => api.get('/follow/mutuals').then((r) => r.data),
  });
  const start = useMutation({
    mutationFn: (userId: number) => api.post('/chats/direct', { userId }).then((r) => r.data as { id: number }),
    onSuccess: (data) => { chatsChanged(qc); onOpened(data.id); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error || '대화를 열지 못했어요.'),
  });
  return (
    <ChatSheet title="이웃에게 메시지" onClose={onClose} testId="neighbor-picker">
      {isLoading ? (
        <p className="px-5 py-8 text-center text-sm text-gray-600">불러오는 중…</p>
      ) : mutuals.length === 0 ? (
        <p className="px-5 pb-6 pt-2 text-sm leading-relaxed text-gray-600">서로 이웃인 사람이 아직 없어요.</p>
      ) : (
        <ul className="pb-2">
          {mutuals.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => start.mutate(u.id)}
                disabled={start.isPending}
                className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <PersonAvatar person={u} size={36} />
                <span className="min-w-0 flex-1 truncate text-[15px] text-gray-900">{displayName(u)}</span>
                <span className="shrink-0 text-xs text-gray-600">{chatRoleTag(u.role)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ChatSheet>
  );
}
