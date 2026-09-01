import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';

/**
 * 이웃(단방향 팔로우) 버튼 — 작가/갤러리 프로필 어디서든 쓴다.
 *  · 추가하면 상대에게 알림이 간다(서버).
 *  · 자기 자신이면 렌더하지 않는다(isMe).
 *  · 비로그인은 누르면 로그인으로 유도.
 */
interface Status { following: boolean; followerCount: number; followingCount: number; isMe: boolean }

export default function FollowButton({ userId, className = '', iconOnly = false }: { userId: number; className?: string; iconOnly?: boolean }) {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery<Status>({
    queryKey: ['follow', userId],
    queryFn: () => api.get(`/follow/${userId}`).then((r) => r.data),
  });

  const mut = useMutation({
    mutationFn: (next: boolean) =>
      (next ? api.post(`/follow/${userId}`) : api.delete(`/follow/${userId}`)).then((r) => r.data),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ['follow', userId] });
      const prev = qc.getQueryData<Status>(['follow', userId]);
      qc.setQueryData<Status>(['follow', userId], (s) =>
        s ? { ...s, following: next, followerCount: Math.max(0, s.followerCount + (next ? 1 : -1)) } : s);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['follow', userId], ctx.prev); toast.error('잠시 후 다시 시도해주세요.'); },
    onSuccess: (d, next) => { if (next) toast.success('이웃으로 추가했어요.'); qc.setQueryData(['follow', userId], (s: Status) => ({ ...s, ...d })); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['follow', userId] }); qc.invalidateQueries({ queryKey: ['story-feed'] }); },
  });

  if (data?.isMe) return null;

  const following = data?.following ?? false;
  const onClick = () => {
    if (!isAuthenticated) { toast.error('로그인이 필요합니다.'); navigate('/login'); return; }
    mut.mutate(!following);
  };

  // 아이콘 변형 — 작품 모달 액션줄처럼 "아이콘만" 얹어야 하는 자리용. 이웃이면 채워진 하늘색, 아니면 회색.
  if (iconOnly) {
    return (
      <button
        onClick={onClick}
        disabled={mut.isPending}
        title={following ? '이웃 — 누르면 취소' : '이웃 추가'}
        aria-label={following ? '이웃 취소' : '이웃 추가'}
        className={`cursor-pointer disabled:opacity-40 ${className}`}
      >
        {following
          ? <UserCheck size={20} className="text-[#2563eb]" />
          : <UserPlus size={20} className="text-gray-300 hover:text-gray-500" />}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={mut.isPending}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
        following
          ? 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
          : 'bg-gray-950 text-white hover:bg-gray-800'
      } ${className}`}
    >
      {following ? <><UserCheck size={15} /> 이웃</> : <><UserPlus size={15} /> 이웃 추가</>}
    </button>
  );
}
