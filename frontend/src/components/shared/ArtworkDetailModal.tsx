import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, X, User, MessageCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { displayName, getDday } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import FollowButton from './FollowButton';
import type { ExploreImage } from '@/types';

/**
 * 작품 확대 모달 (공용)
 *
 * 둘러보기 / 홈 하이라이트 / 마이페이지 좋아요 보드 / 갤러리 관심 작품 보드에서 모두 이 모달을 쓴다.
 * 어디서 클릭하든 **원본 비율 확대 + 좋아요**라는 동일한 경험을 주는 게 목적.
 *
 * 갤러리 계정에는 여기에 스크랩/초대 액션이 **아이콘으로만** 얹힌다.
 * (별도 버튼 블록으로 넣었더니 이미지가 밀려 "확대가 안 되고 메뉴만 뜬다"는 문제가 있었다)
 */
interface Props {
  image: ExploreImage;
  onClose: () => void;
  /** 목록 상태를 함께 들고 있는 화면(둘러보기)에서 좋아요 결과를 동기화하려면 전달 */
  onUpdate?: (img: ExploreImage) => void;
}

export default function ArtworkDetailModal({ image: initial, onClose, onUpdate }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [image, setImage] = useState<ExploreImage>(initial);
  const [showLikers, setShowLikers] = useState(false);

  // 부모가 새 이미지를 넘기면 따라간다(목록에서 다른 작품을 연 경우)
  useEffect(() => { setImage(initial); }, [initial]);

  const isOwner = user?.id === image.artist.id;

  /* 갠톡 열기 — 이미 있으면 그 방으로, 없으면 만들어서 그 방으로 (서버가 판단) */
  const openChat = useMutation({
    mutationFn: () => api.post('/chats/direct', { userId: image.artist.id }).then(r => r.data),
    onSuccess: (data: { id: number }) => {
      onClose();
      navigate(`/messages?chat=${data.id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '대화를 열지 못했습니다.'),
  });

  const apply = (next: ExploreImage) => {
    setImage(next);
    onUpdate?.(next);
  };

  // ESC 키 + 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // 좋아요 토글 — 켤 때 "작가에게 전달됐어요"를 보여주는 게 핵심(내 클릭이 사람에게 닿았다는 실감)
  const likeMutation = useMutation({
    mutationFn: () => api.post(`/explore/${image.id}/like`),
    onMutate: () => {
      const newLiked = !image.isLiked;
      apply({ ...image, isLiked: newLiked, likeCount: image.likeCount + (newLiked ? 1 : -1) });
      return { newLiked };
    },
    onSuccess: (_res, _vars, ctx) => {
      if (ctx?.newLiked) toast.success('작가에게 전달됐어요', { icon: '❤️' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['explore'] });
      queryClient.invalidateQueries({ queryKey: ['explore-highlight'] });
      queryClient.invalidateQueries({ queryKey: ['my-likes'] });
    },
  });

  // 좋아요한 사람 목록 (이미지 주인만)
  const { data: likersData } = useQuery({
    queryKey: ['explore-likes', image.id],
    queryFn: () => api.get(`/explore/${image.id}/likes`).then(r => r.data),
    enabled: isOwner && showLikers,
    staleTime: 30000,
  });

  const handleLike = () => {
    if (!isAuthenticated) {
      toast.error('로그인이 필요합니다.');
      return;
    }
    likeMutation.mutate();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative bg-white max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-white/80 text-gray-500 hover:text-gray-900 z-10 cursor-pointer"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        {/* 이미지 — 원본 비율 그대로(정사각 크롭 없이), 화면에 맞게 contain.
            min-h를 주는 이유: 이미지 로드에 실패하면 높이가 0이 되어 아래 정보줄이 위로 올라오고
            우상단 닫기 버튼이 좋아요 버튼을 덮어 클릭이 막힌다(E2E에서 실제로 재현). */}
        <img src={image.url} alt="" className="w-full max-h-[75vh] min-h-[200px] object-contain bg-gray-50" />

        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => { onClose(); navigate(`/portfolio/${image.artist.id}`); }}
              className="flex items-center gap-2 hover:opacity-70 transition-opacity cursor-pointer min-w-0"
            >
              {image.artist.avatar ? (
                <img src={image.artist.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                  <User size={14} className="text-gray-400" />
                </div>
              )}
              <span className="text-sm font-medium text-gray-900 hover:underline truncate">
                {displayName(image.artist)}
              </span>
            </button>

            <div className="flex items-center gap-3 shrink-0">
              {/* 이웃(팔로우) — 여기가 이웃인지 바로 보이고, 추가/삭제도 여기서 한다.
                  ⚠️ 카드에서 바로 '공모 초대'하던 버튼은 없앴다. 초대는 공모 쪽(내 공모 → 지원자 관리 → 작가 초대)에서만 하고,
                  서버도 '좋아요했거나 서로이웃'인 작가만 초대되게 막는다. 여기선 관심 표시(하트)·이웃 맺기까지만. */}
              {isAuthenticated && !isOwner && (
                <FollowButton userId={image.artist.id} iconOnly />
              )}

              {/*
                [메시지] — 갠톡을 여는 **몇 안 되는 길목** 중 하나.
                대화 상대를 임의로 검색해 말 걸 수는 없고, 이렇게 작품을 보고 있는 자리에서만 시작한다.
                역할을 가리지 않는다 — 작가끼리도 서로 연락할 수 있어야 한다(예전 쪽지는 이게 막혀 있었다).
                ⚠️ 자기 작품에는 띄우지 않는다(자기 자신과의 대화는 서버가 400 으로 막는다).
              */}
              {isAuthenticated && !isOwner && (
                <button
                  onClick={() => openChat.mutate()}
                  disabled={openChat.isPending}
                  title={`${displayName(image.artist)} 님에게 메시지`}
                  aria-label="메시지 보내기"
                  className="cursor-pointer disabled:opacity-40"
                >
                  <MessageCircle size={20} className="text-gray-300 hover:text-gray-500" />
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <button onClick={handleLike} aria-label={image.isLiked ? '좋아요 취소' : '좋아요'} className="cursor-pointer">
                  <Heart
                    size={20}
                    className={image.isLiked ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300 hover:text-gray-500'}
                  />
                </button>
                {isOwner ? (
                  <button
                    onClick={() => setShowLikers(!showLikers)}
                    className="text-sm text-gray-500 underline underline-offset-2 cursor-pointer"
                  >
                    {image.likeCount}
                  </button>
                ) : (
                  <span className="text-sm text-gray-500">{image.likeCount}</span>
                )}
              </div>
            </div>
          </div>

          {/* 좋아요한 사람 목록 (이미지 주인만) */}
          <AnimatePresence>
            {isOwner && showLikers && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mt-3"
              >
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-400 mb-2">좋아요한 사람</p>
                  <LikerList likers={likersData?.likers} onNavigate={(id) => { onClose(); navigate(`/portfolio/${id}`); }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

// ===== 좋아요한 사람 목록 (공용) =====
export interface Liker {
  id: number;
  name: string;
  nickname?: string | null;
  avatar?: string | null;
}

export function LikerList({ likers, onNavigate }: { likers?: Liker[]; onNavigate: (id: number) => void }) {
  if (!likers || likers.length === 0) {
    return <p className="text-xs text-gray-300 py-2">아직 좋아요한 사람이 없습니다.</p>;
  }
  return (
    <div className="space-y-2">
      {likers.map((liker) => (
        <button
          key={liker.id}
          onClick={() => onNavigate(liker.id)}
          className="flex items-center gap-2 text-sm text-gray-700 hover:underline cursor-pointer"
        >
          {liker.avatar ? (
            <img src={liker.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
              <User size={10} className="text-gray-400" />
            </div>
          )}
          {displayName(liker)}
        </button>
      ))}
    </div>
  );
}

/**
 * 작품별 좋아요 목록 모달 — 작가가 마이페이지 포트폴리오에서 "누가 눌렀는지" 확인용(인스타 방식).
 * 서버는 이미지 주인에게만 likers를 내려준다(`GET /explore/:id/likes`).
 */
export function ArtworkLikersModal({ imageId, onClose }: { imageId: number; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['explore-likes', imageId],
    queryFn: () => api.get(`/explore/${imageId}/likes`).then(r => r.data),
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="bg-white w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-900">
            좋아요 {data?.likeCount ?? 0}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 cursor-pointer" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 max-h-80 overflow-y-auto">
          {isLoading ? (
            <p className="text-xs text-gray-400 py-2">불러오는 중…</p>
          ) : (
            <LikerList likers={data?.likers} onNavigate={(id) => { onClose(); navigate(`/portfolio/${id}`); }} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ===== 공모 초대 모달 (갤러리 전용) =====
interface InvitableExhibition {
  id: number;
  title: string;
  deadline: string;
  status: string;
  recruitmentClosed?: boolean;
  confirmed?: boolean;
  ended?: boolean;
}

export function InviteModal({ artistId, artistName, onClose }: { artistId: number; artistName: string; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  // 모집 중인 내 공모만 초대 대상 (마감/확정/종료 제외 — 서버도 같은 규칙으로 막는다)
  const { data: exhibitions = [], isLoading } = useQuery<InvitableExhibition[]>({
    queryKey: ['my-exhibitions'],
    queryFn: () => api.get('/exhibitions/my-exhibitions').then(r => r.data),
  });
  const invitable = exhibitions.filter(
    (e) => e.status === 'APPROVED' && !e.recruitmentClosed && !e.confirmed && !e.ended && getDday(e.deadline) >= 0
  );

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post(`/exhibitions/${selected}/invite`, { artistId, message: message.trim() || undefined }),
    onSuccess: () => {
      toast.success(`${artistName} 작가에게 초대를 보냈습니다.`);
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || '초대에 실패했습니다.');
    },
  });

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">공모에 초대</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 cursor-pointer" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          <span className="font-medium text-gray-900">{artistName}</span> 작가에게 초대 알림을 보냅니다.
        </p>

        {isLoading ? (
          <p className="text-sm text-gray-400 py-6 text-center">불러오는 중…</p>
        ) : invitable.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">
            초대할 수 있는 공모가 없습니다.<br />
            <span className="text-xs">(승인 완료 · 모집 중인 공모만 가능)</span>
          </p>
        ) : (
          <>
            <label className="block text-xs text-gray-500 mb-1.5">공모 선택</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto mb-4">
              {invitable.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelected(e.id)}
                  className={`w-full text-left px-3 py-2 text-sm border transition-colors cursor-pointer ${
                    selected === e.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="block truncate">{e.title}</span>
                  <span className="block text-xs text-gray-400">D-{getDday(e.deadline)}</span>
                </button>
              ))}
            </div>

            <label className="block text-xs text-gray-500 mb-1.5">메시지 (선택, 300자)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 300))}
              rows={3}
              placeholder="작품 잘 봤습니다. 함께하고 싶습니다."
              className="w-full border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-900"
            />

            {/* 초대받은 작가는 지원서를 다시 쓰지 않는다 — 갤러리가 기대치를 알 수 있게 안내 */}
            <p className="mt-3 text-xs text-gray-400">
              초대한 작가는 <span className="text-gray-600">지원서 작성 없이 포트폴리오로 간편 지원</span>합니다.
              지원이 들어오면 알림을 받고 수락/거절을 결정하시면 됩니다.
              <br />
              <span className="text-gray-400">초대는 하루 10명까지 보낼 수 있습니다.</span>
            </p>

            <button
              onClick={() => inviteMutation.mutate()}
              disabled={!selected || inviteMutation.isPending}
              className="w-full mt-4 py-2.5 bg-gray-900 text-white text-sm disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
            >
              {inviteMutation.isPending ? '보내는 중…' : '초대 보내기'}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
