import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Lock, Trash2, CornerDownRight, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo } from '@/lib/utils';

/**
 * 방명록 — 작가 홈페이지(`/portfolio/:userId`) 하단.
 *   · 읽기는 공개, 쓰기는 로그인. 비밀글은 방 주인·작성자만 본문을 본다.
 *   · 답글은 **방 주인만** 단다.
 */
interface GbAuthor { id: number; name: string; avatar: string | null; role: string }
interface GbEntry {
  id: number; body: string; secret: boolean; locked: boolean; createdAt: string;
  author: GbAuthor; mine: boolean; replies: GbEntry[];
}
interface GbData { entries: GbEntry[]; isOwner: boolean }

const roleLabel = (role: string) => (role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'ADMIN' ? '운영' : '');

function Avatar({ a }: { a: GbAuthor }) {
  return (
    <Link to={`/portfolio/${a.id}`} className="shrink-0">
      {a.avatar
        ? <img src={a.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
        : <div className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">{a.name.slice(0, 1)}</div>}
    </Link>
  );
}

export default function Guestbook({ userId }: { userId: number }) {
  const { isAuthenticated } = useAuthStore();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [secret, setSecret] = useState(false);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const { data, isLoading } = useQuery<GbData>({
    queryKey: ['guestbook', userId],
    queryFn: () => api.get(`/guestbook/${userId}`).then((r) => r.data),
  });

  const post = useMutation({
    mutationFn: (payload: { body: string; secret?: boolean; parentId?: number }) =>
      api.post(`/guestbook/${userId}`, payload).then((r) => r.data),
    onSuccess: () => {
      setBody(''); setSecret(false); setReplyTo(null); setReplyBody('');
      qc.invalidateQueries({ queryKey: ['guestbook', userId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '등록에 실패했습니다.'),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/guestbook/${userId}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guestbook', userId] }),
    onError: () => toast.error('삭제에 실패했습니다.'),
  });

  const isOwner = data?.isOwner ?? false;
  const entries = data?.entries ?? [];

  const Row = ({ e, isReply = false }: { e: GbEntry; isReply?: boolean }) => (
    <div className={isReply ? 'ml-8 mt-2 flex gap-2.5 rounded-lg bg-gray-50 p-3' : 'flex gap-2.5'}>
      {isReply && <CornerDownRight size={15} className="mt-1 shrink-0 text-gray-300" />}
      <Avatar a={e.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Link to={`/portfolio/${e.author.id}`} className="font-semibold text-gray-700 hover:underline">{e.author.name}</Link>
          {roleLabel(e.author.role) && <span>· {roleLabel(e.author.role)}</span>}
          <span>·</span>
          <span>{timeAgo(e.createdAt)}</span>
          {(e.mine || isOwner) && (
            <button onClick={() => del.mutate(e.id)} aria-label="삭제" className="ml-1 text-gray-300 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {e.locked ? (
          <p className="mt-1 inline-flex items-center gap-1 text-sm text-gray-400"><Lock size={13} /> 비밀글입니다.</p>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 [overflow-wrap:anywhere]">
            {e.secret && <Lock size={12} className="mr-1 inline text-gray-400" />}{e.body}
          </p>
        )}

        {/* 방 주인만 답글 (최상위 글에만) */}
        {!isReply && isOwner && (
          replyTo === e.id ? (
            <div className="mt-2">
              <textarea
                value={replyBody}
                onChange={(ev) => setReplyBody(ev.target.value.slice(0, 1000))}
                placeholder="답글을 남겨보세요."
                className="w-full resize-none rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 [overflow-wrap:anywhere]"
                rows={2}
              />
              <div className="mt-1 flex justify-end gap-2 text-sm">
                <button onClick={() => { setReplyTo(null); setReplyBody(''); }} className="text-gray-400 hover:text-gray-700">취소</button>
                <button
                  onClick={() => replyBody.trim() && post.mutate({ body: replyBody.trim(), parentId: e.id })}
                  disabled={!replyBody.trim() || post.isPending}
                  className="font-medium text-[#dc3545] disabled:text-gray-300"
                >답글</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setReplyTo(e.id); setReplyBody(''); }} className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700">
              <MessageSquare size={12} /> 답글
            </button>
          )
        )}
      </div>
    </div>
  );

  return (
    <section id="guestbook" className="mt-16 scroll-mt-20 border-t border-gray-100 pt-10">
      <h2 className="mb-5 text-lg font-bold tracking-tight font-serif text-gray-900">
        방명록<span className="text-[#dc3545]"> Guestbook</span>
        {entries.length > 0 && <span className="ml-2 align-middle text-sm font-normal text-gray-400">{entries.length}</span>}
      </h2>

      {/* 작성 */}
      {isAuthenticated ? (
        <div className="mb-6 rounded-xl border border-gray-200 p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 1000))}
            placeholder={isOwner ? '내 방명록에 글을 남길 수 있어요.' : '작가에게 응원의 한마디를 남겨보세요.'}
            className="min-h-[56px] w-full resize-none text-sm leading-relaxed text-gray-800 placeholder:text-gray-300 focus:outline-none [overflow-wrap:anywhere]"
          />
          <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} className="accent-gray-900" />
              <Lock size={12} /> 비밀글
            </label>
            <button
              onClick={() => body.trim() && post.mutate({ body: body.trim(), secret })}
              disabled={!body.trim() || post.isPending}
              className="rounded-full bg-gray-950 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-200"
            >
              {post.isPending ? '남기는 중…' : '남기기'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-6 rounded-xl border border-dashed border-gray-200 py-4 text-center text-sm text-gray-400">
          <Link to="/login" className="font-medium text-[#dc3545] hover:underline">로그인</Link> 후 방명록을 남길 수 있어요.
        </p>
      )}

      {/* 목록 */}
      {isLoading ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />)}</div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">아직 방명록이 없습니다. 첫 글을 남겨보세요.</p>
      ) : (
        <div className="space-y-5">
          {entries.map((e) => (
            <div key={e.id}>
              <Row e={e} />
              {e.replies.map((r) => <Row key={r.id} e={r} isReply />)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
