import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, ArrowLeft, Trash2, Edit3, User, Eye, Pin, PinOff, Megaphone } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo } from '@/lib/utils';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

interface Author { id: number | null; name: string; avatar: string | null; role: string | null; anonymous: boolean; mine: boolean }
interface PostCategory { id: number; name: string; slug: string }
interface Comment { id: number; body: string; createdAt: string; author: Author }
interface PostDetail {
  id: number; title: string; body: string; images: string[];
  likeCount: number; commentCount: number; viewCount: number; createdAt: string; liked: boolean;
  notice: boolean; pinned: boolean; category: PostCategory | null;
  author: Author; comments: Comment[];
}

const roleLabel = (role: string | null) =>
  role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'ADMIN' ? '운영' : '';

/** 작성자 줄 — 익명이면 신원 숨김, 실명이면 아바타+닉네임+역할. 본인 페이지 이동은 실명일 때만. */
function AuthorRow({ a, navigate }: { a: Author; navigate: (to: string) => void }) {
  const clickable = !a.anonymous && a.id != null;
  return (
    <button
      disabled={!clickable}
      onClick={() => clickable && navigate(`/portfolio/${a.id}`)}
      className={`flex items-center gap-2 ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
    >
      {a.avatar ? (
        <img src={a.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gray-200 text-gray-400"><User size={14} /></span>
      )}
      <span className="text-sm font-medium text-gray-900">{a.name}</span>
      {roleLabel(a.role) && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{roleLabel(a.role)}</span>}
    </button>
  );
}

export default function CommunityPostPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [comment, setComment] = useState('');
  const [anonComment, setAnonComment] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  const { data: post, isLoading, error } = useQuery<PostDetail>({
    queryKey: ['community', 'post', id],
    queryFn: () => api.get(`/community/${id}`).then((r) => r.data),
    enabled: !!id,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['community', 'post', id] });
    queryClient.invalidateQueries({ queryKey: ['community'] });
    queryClient.invalidateQueries({ queryKey: ['community-popular'] });
  };

  const like = useMutation({
    mutationFn: () => api.post(`/community/${id}/like`).then((r) => r.data),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['community', 'post', id] });
      const prev = queryClient.getQueryData<PostDetail>(['community', 'post', id]);
      if (prev) queryClient.setQueryData(['community', 'post', id], { ...prev, liked: !prev.liked, likeCount: prev.likeCount + (prev.liked ? -1 : 1) });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(['community', 'post', id], ctx.prev); },
    onSettled: invalidate,
  });

  const addComment = useMutation({
    mutationFn: () => api.post(`/community/${id}/comments`, { body: comment.trim(), anonymous: anonComment }),
    onSuccess: () => { setComment(''); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '댓글 등록 실패'),
  });

  const removePost = useMutation({
    mutationFn: () => api.delete(`/community/${id}`),
    onSuccess: () => { toast.success('삭제했습니다.'); invalidate(); navigate('/community'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제 실패'),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState<{ title: string; body: string; anonymous: boolean } | null>(null);
  const editPost = useMutation({
    mutationFn: (data: { title: string; body: string; anonymous: boolean }) =>
      api.patch(`/community/${id}`, data),
    onSuccess: () => { toast.success('수정했습니다.'); setEditOpen(false); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '수정 실패'),
  });

  // ── 관리자 조작 ──────────────────────────────────────────────
  // ⚠️ 화면에서 감추는 건 권한이 아니다 — 서버가 authorize('ADMIN') 로 다시 막는다.
  const togglePin = useMutation({
    mutationFn: () => api.patch(`/community/${id}/pin`, { pinned: !post?.pinned }),
    onSuccess: () => { invalidate(); toast.success(post?.pinned ? '고정을 해제했습니다.' : '맨 위에 고정했습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '고정 변경 실패'),
  });
  const toggleNotice = useMutation({
    mutationFn: () => api.patch(`/community/${id}/notice`, { notice: !post?.notice }),
    onSuccess: () => { invalidate(); toast.success(post?.notice ? '공지를 해제했습니다.' : '공지로 지정했습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '공지 변경 실패'),
  });

  const removeComment = useMutation({
    mutationFn: (cid: number) => api.delete(`/community/${id}/comments/${cid}`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제 실패'),
  });

  if (isLoading) return <div className="mx-auto max-w-3xl px-6 py-10"><div className="h-40 animate-pulse rounded-xl bg-gray-100" /></div>;
  if (error || !post) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center text-gray-400">
        <p>글을 찾을 수 없습니다.</p>
        <button onClick={() => navigate('/community')} className="mt-4 text-sm text-gray-600 underline">커뮤니티로</button>
      </div>
    );
  }

  const requireLogin = () => { if (!isAuthenticated) { toast.error('로그인이 필요합니다.'); navigate('/login'); return true; } return false; };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8 md:py-10">
      <button onClick={() => navigate('/community')} className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900">
        <ArrowLeft size={15} /> 커뮤니티
      </button>

      <article>
        {(post.notice || post.pinned || post.category) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {post.notice && <span className="rounded bg-[#c4302b] px-1.5 py-0.5 text-[11px] font-semibold text-white">공지</span>}
            {post.pinned && <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"><Pin size={11} /> 고정</span>}
            {post.category && !(post.notice && post.category.name === '공지') && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{post.category.name}</span>
            )}
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold leading-snug text-gray-950 break-keep [overflow-wrap:anywhere]">{post.title}</h1>
          <div className="flex shrink-0 items-center gap-0.5">
            {/* ⚠️ Admin 은 **공지·고정**을 여기서 바꾼다 (목록에서도 되지만 글을 읽고 판단하는 게 보통이다) */}
            {isAdmin && (
              <>
                <button onClick={() => toggleNotice.mutate()} title={post.notice ? '공지 해제' : '공지로 지정'}
                  className={`p-1 ${post.notice ? 'text-[#c4302b]' : 'text-gray-300 hover:text-[#c4302b]'}`}>
                  <Megaphone size={16} />
                </button>
                <button onClick={() => togglePin.mutate()} title={post.pinned ? '고정 해제' : '맨 위에 고정'}
                  className={`p-1 ${post.pinned ? 'text-amber-600' : 'text-gray-300 hover:text-amber-600'}`}>
                  {post.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
              </>
            )}
            {/* 수정 (작성자만) */}
            {post.author.mine && (
              <button onClick={() => { setEditData({ title: post.title, body: post.body, anonymous: post.author.anonymous }); setEditOpen(true); }} aria-label="수정"
                title="수정"
                className="p-1 text-gray-300 hover:text-gray-900"><Edit3 size={16} /></button>
            )}
            {/* ⚠️ 삭제는 원래 서버가 **작성자·Admin 둘 다** 허용했는데 화면이 `mine` 일 때만 그렸다.
                그래서 관리자가 신고받은 글을 못 지웠다 — 권한은 있는데 손이 닿지 않았다. */}
            {(post.author.mine || isAdmin) && (
              <button onClick={() => setDeleteOpen(true)} aria-label="삭제"
                title={post.author.mine ? '삭제' : '글 삭제 (관리자)'}
                className="p-1 text-gray-300 hover:text-[#c4302b]"><Trash2 size={16} /></button>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <AuthorRow a={post.author} navigate={navigate} />
          <span className="text-xs text-gray-400">{timeAgo(post.createdAt)}</span>
          <span className="flex items-center gap-0.5 text-xs text-gray-400"><Eye size={12} /> {post.viewCount}</span>
        </div>

        <p className="mt-6 whitespace-pre-wrap break-keep text-[15px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{post.body}</p>

        {/* 첨부 사진 — 원본 비율 유지(작품일 수 있으니 자르지 않는다) */}
        {post.images.length > 0 && (
          <div className="mt-5 space-y-3">
            {post.images.map((url, i) => (
              <Thumb key={i} src={url} size="grid" alt="" loading="lazy" className="w-full rounded-lg border border-gray-100 object-contain" />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3 border-y border-gray-100 py-3">
          <button
            onClick={() => !requireLogin() && like.mutate()}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${post.liked ? 'border-[#c4302b] text-[#c4302b]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            <Heart size={15} className={post.liked ? 'fill-[#c4302b]' : ''} /> {post.likeCount}
          </button>
          <span className="text-sm text-gray-400">댓글 {post.commentCount}</span>
        </div>
      </article>

      {/* 댓글 */}
      <section className="mt-6">
        <div className="space-y-4">
          {post.comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              {c.author.avatar ? (
                <img src={c.author.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gray-200 text-gray-400"><User size={13} /></span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{c.author.name}</span>
                  {roleLabel(c.author.role) && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{roleLabel(c.author.role)}</span>}
                  <span className="text-xs text-gray-400">{timeAgo(c.createdAt)}</span>
                  {(c.author.mine || isAdmin) && (
                    <button onClick={() => removeComment.mutate(c.id)}
                      title={c.author.mine ? '삭제' : '댓글 삭제 (관리자)'}
                      className="ml-auto text-xs text-gray-300 hover:text-[#c4302b]">삭제</button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-keep text-sm text-gray-700 [overflow-wrap:anywhere]">{c.body}</p>
              </div>
            </div>
          ))}
          {post.comments.length === 0 && <p className="py-6 text-center text-sm text-gray-400">첫 댓글을 남겨보세요.</p>}
        </div>

        {/* 댓글 입력 */}
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="mb-2 text-xs text-gray-400">
            💡 <strong>@닉네임</strong>을 입력하면 사용자를 태그할 수 있습니다.
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 2000))}
            rows={2}
            placeholder={isAuthenticated ? '댓글을 입력하세요 (@닉네임으로 사용자 태그 가능)' : '로그인 후 댓글을 남길 수 있습니다'}
            disabled={!isAuthenticated}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none disabled:bg-gray-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={anonComment} onChange={(e) => setAnonComment(e.target.checked)} className="accent-gray-900" /> 익명
            </label>
            <button
              onClick={() => !requireLogin() && addComment.mutate()}
              disabled={!comment.trim() || addComment.isPending}
              className="rounded-lg bg-gray-950 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              댓글 등록
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        title="글 삭제"
        message="이 글을 삭제하시겠습니까? 댓글도 함께 사라집니다."
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { setDeleteOpen(false); removePost.mutate(); }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
