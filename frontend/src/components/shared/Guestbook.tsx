import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { Lock, Trash2, CornerDownRight, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo, roleLabel } from '@/lib/utils';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import ConfirmDeleteButton from '@/components/shared/ConfirmDeleteButton';

/**
 * 방명록 — 작가 홈페이지(`/@handle`) 하단.
 *   · 읽기는 공개, 쓰기는 로그인.
 *   · ⚠️ **새 글에는 비밀글이 없다**(2026-09-16 사용자 결정) — 방명록은 남에게 보이라고 쓰는 글이라
 *     체크박스를 없앴다. 다만 **예전에 비밀로 남긴 글은 그대로 가려 둔다** — 쓴 사람은 안 보이는 줄 알고
 *     남겼으므로, 기능을 없앴다고 그 약속을 깨면 안 된다. 그래서 읽기 쪽(`locked`)은 손대지 않았다.
 *   · 답글은 **방 주인만** 단다.
 *   · 색은 **페이지 테마를 물려받는다**(2026-09-16) — 작가가 어두운 배경을 골라도 여기만 흰 상자로 튀지 않게
 *     회색 클래스 대신 `currentColor` 의 투명도로 그린다.
 */
interface GbAuthor { id: number; name: string; avatar: string | null; role: string }
interface GbEntry {
  id: number; body: string; secret: boolean; locked: boolean; createdAt: string;
  author: GbAuthor; mine: boolean; replies: GbEntry[];
}
interface GbData { entries: GbEntry[]; isOwner: boolean }


/* 이름·아바타 링크는 **작가일 때만** — `/portfolio/:id` 는 작가가 아니면 404 라, 갤러리·일반 계정이 남긴 글을 누르면 빈 화면이었다(2026-09-19) */
function Avatar({ a }: { a: GbAuthor }) {
  if (a.role !== 'ARTIST') return <span className="shrink-0">{a.avatar
    ? <img src={a.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
    : <span className="grid h-8 w-8 place-items-center rounded-full bg-current/10 text-xs font-semibold opacity-70">{a.name.slice(0, 1)}</span>}</span>;
  return (
    <Link to={`/portfolio/${a.id}`} className="shrink-0">
      {a.avatar
        ? <img src={a.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
        : <div className="grid h-8 w-8 place-items-center rounded-full bg-current/10 text-xs font-semibold opacity-70">{a.name.slice(0, 1)}</div>}
    </Link>
  );
}

/**
 * @param bare 작가 홈페이지 [방명록] **탭 안**에 들어갈 때(2026-09-25) — 탭이 제목·개수를 이미 들고 있어 머리 라벨·윗줄을 뺀다.
 *             글줄이 1,200px 로 퍼지면 읽기 어려워 폭도 본문 글(max-w-3xl)과 맞춘다.
 */
export default function Guestbook({ userId, bare = false }: { userId: number; bare?: boolean }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const { data, isLoading } = useQuery<GbData>({
    queryKey: ['guestbook', userId],
    queryFn: () => api.get(`/guestbook/${userId}`).then((r) => r.data),
  });

  const post = useMutation({
    mutationFn: (payload: { body: string; parentId?: number }) =>
      api.post(`/guestbook/${userId}`, payload).then((r) => r.data),
    onSuccess: () => {
      setBody(''); setReplyTo(null); setReplyBody('');
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
  const textarea = 'w-full resize-none border bg-transparent p-2 text-sm text-current border-current/20 placeholder:text-current/40 focus:outline-none focus:border-current/50 [overflow-wrap:anywhere]';
  const primaryBtn = 'border border-current px-4 py-1.5 text-sm font-medium hover:bg-current/10 disabled:opacity-30 cursor-pointer';

  const Row = ({ e, isReply = false }: { e: GbEntry; isReply?: boolean }) => (
    <div className={isReply ? 'ml-8 mt-2 flex gap-2.5 bg-current/5 p-3' : 'flex gap-2.5'}>
      {isReply && <CornerDownRight size={15} className="mt-1 shrink-0 opacity-30" />}
      <Avatar a={e.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs opacity-60">
          {e.author.role === 'ARTIST'
            ? <Link to={`/portfolio/${e.author.id}`} className="font-semibold hover:underline">{e.author.name}</Link>
            : <span className="font-semibold">{e.author.name}</span>}
          {roleLabel(e.author.role) && <span>· {roleLabel(e.author.role)}</span>}
          <span>·</span>
          <span>{timeAgo(e.createdAt)}</span>
          {(e.mine || isOwner) && (
            <ConfirmDeleteButton onConfirm={() => del.mutate(e.id)} title="방명록 삭제" message="이 글을 지웁니다. 되돌릴 수 없습니다." className="ml-1 hover:text-accent">
              <Trash2 size={13} />
            </ConfirmDeleteButton>
          )}
        </div>
        {e.locked ? (
          <p className="mt-1 inline-flex items-center gap-1 text-sm opacity-50"><Lock size={13} /> 비밀글입니다.</p>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
            {e.secret && <Lock size={12} className="mr-1 inline opacity-50" />}{e.body}
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
                className={textarea}
                rows={2}
              />
              <div className="mt-1 flex justify-end gap-3 text-sm">
                <button onClick={() => { setReplyTo(null); setReplyBody(''); }} className="opacity-60 hover:opacity-100">취소</button>
                <button
                  onClick={() => replyBody.trim() && post.mutate({ body: replyBody.trim(), parentId: e.id })}
                  disabled={!replyBody.trim() || post.isPending}
                  className="font-medium underline underline-offset-4 disabled:opacity-30"
                >답글</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setReplyTo(e.id); setReplyBody(''); }} className="mt-1 inline-flex items-center gap-1 text-xs opacity-60 hover:opacity-100">
              <MessageSquare size={12} /> 답글
            </button>
          )
        )}
      </div>
    </div>
  );

  return (
    <section id="guestbook" className={bare ? 'max-w-3xl' : 'mt-16 scroll-mt-20 border-t border-current/15 pt-6'}>
      {!bare && (
        <h2 className="mb-5 text-[11px] font-semibold uppercase tracking-[0.22em] opacity-60">
          방명록{entries.length > 0 && <span className="ml-2 font-normal tracking-normal">{entries.length}</span>}
        </h2>
      )}

      {/* 작성 */}
      {isAuthenticated ? (
        <div className="mb-6 border border-current/20 p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 1000))}
            placeholder={isOwner ? '내 방명록에 글을 남길 수 있어요.' : '작가에게 응원의 한마디를 남겨보세요.'}
            className="min-h-[56px] w-full resize-none bg-transparent text-sm leading-relaxed text-current placeholder:text-current/40 focus:outline-none [overflow-wrap:anywhere]"
          />
          <div className="mt-1 flex items-center justify-end border-t border-current/10 pt-2">
            <button
              onClick={() => body.trim() && post.mutate({ body: body.trim() })}
              disabled={!body.trim() || post.isPending}
              className={primaryBtn}
            >
              {post.isPending ? '남기는 중…' : '남기기'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-6 border border-dashed border-current/25 py-4 text-center text-sm opacity-80">
          <Link
            to="/login"
            onClick={() => setPostLoginRedirect(location.pathname + location.search)}
            className="font-medium underline underline-offset-4"
          >로그인</Link> 후 방명록을 남길 수 있어요.
        </p>
      )}

      {/* 목록 */}
      {isLoading ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-14 animate-pulse bg-current/5" />)}</div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm opacity-50">아직 방명록이 없습니다. 첫 글을 남겨보세요.</p>
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
