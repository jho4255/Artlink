import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Heart, Megaphone, MessageCircle, Pencil, Pin, PinOff, Share2, Trash2, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ImageLightbox from '@/components/shared/ImageLightbox';
import FollowButton from '@/components/shared/FollowButton';
import PostBody, { type PostBodyImage } from '@/components/post/PostBody';
import ProfilePopover, { type ProfileTarget } from '@/components/post/ProfilePopover';
import { scrollToTarget } from '@/lib/scrollToTarget';
import type { PollView } from '@/lib/postPoll';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import { shareLinkNative } from '@/lib/native';
import { timeAgo, roleLabel, apiErrorMessage } from '@/lib/utils';
import { legacyToPostDoc, type PostDoc } from '@/lib/postDoc';

/**
 * 커뮤니티 글 화면 (2026-11-13 다시 그림) — 매거진 지면처럼: 경로(커뮤니티 / 탭) → 제목 → 작성자 줄 → 본문 → 좋아요·공유 → 작성자 카드 → 댓글 → 이 탭의 다른 글.
 *
 * - 본문은 문서(`doc`)를 편집기 없이 그린다(components/post/PostBody). 옛 글은 같은 문서로 바꿔 같은 화면이 그린다 — 화면이 둘이 아니다.
 * - 고치기는 글쓰기 화면(`/community/:id/edit`)에서 — 예전의 제목·내용만 고치던 창은 없앴다(사진을 못 고쳤다).
 * - 익명 글은 작성자 카드·홈페이지 링크를 그리지 않는다(서버가 신원을 통째로 가려 보낸다 — 화면에서 가리지 않는다).
 * - 관리자: 공지·고정·삭제. 작성자: 고치기·삭제. ⚠️ 화면에서 감추는 건 권한이 아니다 — 서버가 다시 막는다.
 * - 댓글(2026-11-13): 답글은 맨 위 댓글 아래 **한 단계**(답글의 답글은 '○○님에게'). @멘션은 없다 — 답글이 그 일을 한다.
 *   답글이 달린 댓글을 지우면 '삭제된 댓글입니다' 자리만 남는다. 알림(`?comment=`)으로 오면 그 댓글로 내려간다.
 * - 이름·사진을 누르면 프로필 카드(홈페이지 · 이웃 추가) — 실명인 사람만(서버 `profiles`).
 */
interface Author {
  id: number | null; name: string; avatar: string | null; role: string | null; anonymous: boolean; mine: boolean;
  homepage?: string | null; intro?: string | null;
}
interface Tab { id: number; name: string; slug: string; layout?: string; writePolicy?: string }
/** 지운 댓글(답글이 남아 자리만 둔 것)은 author 가 null, body 가 빈 글 */
interface Reply { id: number; body: string; createdAt: string; deleted: boolean; author: Author | null; replyTo: { name: string } | null }
interface Comment { id: number; body: string; createdAt: string; deleted: boolean; author: Author | null; replies: Reply[] }
interface Related {
  id: number; title: string; excerpt: string; cover: string | null; readingMinutes: number; createdAt: string;
  category: Tab | null; author: Author; likeCount: number; commentCount: number;
}
interface PostDetail {
  id: number; title: string; body: string; images: string[]; doc: PostDoc | null; readingMinutes: number;
  likeCount: number; commentCount: number; viewCount: number; createdAt: string; updatedAt: string; liked: boolean;
  notice: boolean; pinned: boolean; category: Tab | null;
  author: Author; comments: Comment[]; related: Related[];
  /** 실명인 글쓴이·댓글 쓴 사람의 홈페이지·소개(user id →) — 프로필 카드 */
  profiles?: Record<string, { homepage: string | null; intro: string | null }>;
  poll?: PollView | null;
}

function Avatar({ a, size }: { a: Author; size: number }) {
  if (a.avatar) return <img src={a.avatar} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-gray-200 text-gray-500" style={{ width: size, height: size }} aria-hidden="true">
      {a.anonymous || !a.name ? <User size={Math.round(size * 0.45)} /> : <span className="text-[13px] font-semibold">{a.name.slice(0, 1)}</span>}
    </span>
  );
}

/** 글 읽은 만큼 — 위쪽 2px 줄(상단바 아래) */
function ReadingProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 본문만 잰다 — 글 전체(댓글·다른 글 포함)로 재면 본문을 다 읽어도 막대가 절반에 머문다.
        // 본문 끝이 화면 아래쪽(85%)에 들어오면 다 읽은 것으로 친다
        const el = document.querySelector('[data-post-body]') as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setP(r.height > 0 ? Math.min(1, Math.max(0, (window.innerHeight * 0.85 - r.top) / r.height)) : 1);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-16 z-40 h-[2px] lg:top-20">
      <div className="h-full origin-left bg-gray-900 transition-transform duration-150" style={{ transform: `scaleX(${p})` }} />
    </div>
  );
}

export default function CommunityPostPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [comment, setComment] = useState('');
  const [anonComment, setAnonComment] = useState(false);
  // 답글 — 어느 댓글에(to) 다는가 · 그 댓글이 든 맨 위 댓글(thread) · 받는 사람 이름
  const [reply, setReply] = useState<{ to: number; thread: number; name: string } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyAnon, setReplyAnon] = useState(false);
  const [profile, setProfile] = useState<{ el: HTMLElement; target: ProfileTarget } | null>(null);
  const [params, setParams] = useSearchParams();
  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: PostBodyImage[]; index: number } | null>(null);
  const [justPublished, setJustPublished] = useState(() => !!(location.state as { justPublished?: boolean } | null)?.justPublished);
  const isAdmin = user?.role === 'ADMIN';

  // 방금 올렸다는 표시는 한 번만(새로고침해도 다시 뜨지 않게 주소의 상태를 지운다)
  useEffect(() => {
    if ((location.state as { justPublished?: boolean } | null)?.justPublished) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: post, isLoading, error } = useQuery<PostDetail>({
    queryKey: ['community', 'post', id],
    queryFn: () => api.get(`/community/${id}`).then((r) => r.data),
    enabled: !!id,
    retry: false,
  });

  const doc = useMemo<PostDoc | null>(() => (post ? post.doc ?? legacyToPostDoc(post.body, post.images) : null), [post]);

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
    onError: (e) => toast.error(apiErrorMessage(e, '댓글 등록 실패')),
  });

  const addReply = useMutation({
    mutationFn: (to: number) => api.post<{ id: number }>(`/community/${id}/comments`, { body: replyText.trim(), anonymous: replyAnon, replyTo: to }).then((r) => r.data),
    onSuccess: (made) => {
      setReply(null); setReplyText(''); setReplyAnon(false);
      invalidate();
      // 단 답글로 데려간다(목록이 다시 그려진 뒤)
      setTimeout(() => showComment(made.id, 'auto'), 350);
    },
    onError: (e) => toast.error(apiErrorMessage(e, '답글 등록 실패')),
  });

  const removePost = useMutation({
    mutationFn: () => api.delete(`/community/${id}`),
    onSuccess: () => { toast.success('삭제했습니다.'); invalidate(); navigate('/community'); },
    onError: (e) => toast.error(apiErrorMessage(e, '삭제 실패')),
  });

  // ── 관리자 조작 ── ⚠️ 화면에서 감추는 건 권한이 아니다 — 서버가 authorize('ADMIN') 로 다시 막는다.
  const togglePin = useMutation({
    mutationFn: () => api.patch(`/community/${id}/pin`, { pinned: !post?.pinned }),
    onSuccess: () => { invalidate(); toast.success(post?.pinned ? '고정을 해제했습니다.' : '맨 위에 고정했습니다.'); },
    onError: (e) => toast.error(apiErrorMessage(e, '고정 변경 실패')),
  });
  const toggleNotice = useMutation({
    mutationFn: () => api.patch(`/community/${id}/notice`, { notice: !post?.notice }),
    onSuccess: () => { invalidate(); toast.success(post?.notice ? '공지를 해제했습니다.' : '공지로 지정했습니다.'); },
    onError: (e) => toast.error(apiErrorMessage(e, '공지 변경 실패')),
  });

  const removeComment = useMutation({
    mutationFn: (cid: number) => api.delete(`/community/${id}/comments/${cid}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e, '삭제 실패')),
  });

  /** 그 댓글로 내려가 잠깐 표시한다 — 못 찾으면(지워졌다) 댓글 칸으로 */
  const showComment = useCallback((cid: number, behavior: ScrollBehavior = 'smooth') => {
    const el = document.querySelector(`[data-comment-id="${cid}"]`) ?? document.getElementById('comments');
    scrollToTarget(el, behavior);
    if (el?.getAttribute('data-comment-id')) {
      setFlash(cid);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 2200);
    }
  }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // 알림으로 왔으면(?comment=) — 글을 받은 뒤 그 댓글로. 다 했으면 주소에서 뗀다(같은 알림을 다시 눌러도 다시 데려가게)
  const wantComment = Number(params.get('comment')) || null;
  const loaded = !!post;
  useEffect(() => {
    if (!loaded || !wantComment) return;
    const t = setTimeout(() => {
      showComment(wantComment);
      setParams((p) => { p.delete('comment'); return p; }, { replace: true });
    }, 120);
    return () => clearTimeout(t);
  }, [loaded, wantComment, showComment, setParams]);

  const closeProfile = useCallback(() => setProfile(null), []);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[680px] px-5 py-12 md:py-16" role="status" aria-label="글을 불러오는 중">
        <div className="h-4 w-28 animate-pulse bg-gray-100" />
        <div className="mt-5 h-9 w-4/5 animate-pulse bg-gray-100" />
        <div className="mt-8 h-56 animate-pulse bg-gray-100" />
      </div>
    );
  }
  if (error || !post || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="text-gray-600">글을 찾을 수 없습니다.</p>
        <Link to="/community" className="mt-4 inline-block text-sm text-gray-900 underline underline-offset-4">커뮤니티로</Link>
      </div>
    );
  }

  const requireLogin = () => {
    if (isAuthenticated) return false;
    setPostLoginRedirect(`/community/${id}`);
    toast('로그인이 필요해요.');
    navigate('/login');
    return true;
  };
  const share = async () => {
    const url = `${window.location.origin}/community/${post.id}`;
    const title = `${post.title} — ArtLink 커뮤니티`;
    if (await shareLinkNative(title, url)) return;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard?.writeText(url);
      toast.success('링크를 복사했어요.');
    } catch { /* 공유 창을 닫았다 */ }
  };
  const a = post.author;
  const tab = post.category;
  const authorHome = !a.anonymous ? a.homepage ?? null : null;

  /** 실명인 사람의 프로필 카드 대상 — 익명·지운 댓글은 null(열지 않는다) */
  const targetOf = (who: Author | null): ProfileTarget | null => {
    if (!who || who.anonymous || who.id == null) return null;
    const p = post.profiles?.[String(who.id)] ?? (who.id === a.id ? { homepage: a.homepage ?? null, intro: a.intro ?? null } : null);
    return { id: who.id, name: who.name, avatar: who.avatar, role: who.role, mine: who.mine, homepage: p?.homepage ?? null, intro: p?.intro ?? null };
  };
  const toggleProfile = (el: HTMLElement, t: ProfileTarget) => setProfile((cur) => (cur && cur.el === el ? null : { el, target: t }));
  const openReply = (to: number, thread: number, who: Author | null) => {
    if (requireLogin()) return;
    setReply((cur) => (cur && cur.to === to ? null : { to, thread, name: who?.name ?? '' }));
    setReplyText('');
  };

  return (
    <div className="bg-white">
      <ReadingProgress />
      {/* ⚠️ AnimatePresence 는 조건 바깥에 — 안에 두면 닫힐 때 애니메이션이 없다(CLAUDE.md 11) */}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox key="lightbox" images={lightbox.images.map((i) => i.src)} captions={lightbox.images.map((i) => i.caption)} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
      <article data-post-article className="mx-auto max-w-[1200px] px-5 pb-16 pt-8 md:px-12 md:pb-24 md:pt-14">
        <header className="mx-auto max-w-[680px]">
          {justPublished && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border border-gray-200 px-4 py-3" role="status">
              <span className="text-[14px] text-gray-800">글을 올렸어요. 링크로 알려 보세요.</span>
              <span className="flex gap-1.5">
                <button type="button" onClick={() => void share()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gray-900 px-3 text-[13px] font-semibold text-white"><Share2 size={14} />공유</button>
                <button type="button" onClick={() => setJustPublished(false)} aria-label="닫기" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"><X size={16} /></button>
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <nav aria-label="경로" className="flex min-w-0 flex-wrap items-center gap-x-2 text-[14px]">
              <Link to="/community" className="text-gray-500 hover:text-gray-900">커뮤니티</Link>
              {tab && (<><span aria-hidden="true" className="text-gray-300">/</span><Link to={`/community?tab=${tab.slug}`} className="font-medium text-accent hover:underline">{tab.name}</Link></>)}
              {post.notice && <span className="font-semibold text-accent">공지</span>}
              {post.pinned && <span className="inline-flex items-center gap-1 text-gray-500"><Pin size={13} />고정</span>}
            </nav>
            <div className="-mr-2 -mt-1.5 flex shrink-0 items-center">
              {isAdmin && (
                <>
                  <button type="button" onClick={() => toggleNotice.mutate()} title={post.notice ? '공지 해제' : '공지로 지정'} aria-label={post.notice ? '공지 해제' : '공지로 지정'}
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-gray-100 ${post.notice ? 'text-accent' : 'text-gray-400'}`}><Megaphone size={17} /></button>
                  <button type="button" onClick={() => togglePin.mutate()} title={post.pinned ? '고정 해제' : '맨 위에 고정'} aria-label={post.pinned ? '고정 해제' : '맨 위에 고정'}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800">{post.pinned ? <PinOff size={17} /> : <Pin size={17} />}</button>
                </>
              )}
              {a.mine && (
                <Link to={`/community/${post.id}/edit`} aria-label="고치기" title="고치기" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800"><Pencil size={17} /></Link>
              )}
              {(a.mine || isAdmin) && (
                <button type="button" onClick={() => setDeleteOpen(true)} aria-label="삭제" title={a.mine ? '삭제' : '글 삭제 (관리자)'}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-accent"><Trash2 size={17} /></button>
              )}
            </div>
          </div>
          <h1 className="mt-3 break-keep text-[28px] font-semibold leading-[1.32] tracking-[-0.01em] text-gray-900 [overflow-wrap:anywhere] md:mt-4 md:text-[40px] md:leading-[1.28]">{post.title}</h1>
          <div className="mt-6 flex items-center gap-3 border-b border-gray-200 pb-7 md:mt-8 md:pb-8">
            <PersonFace who={a} target={targetOf(a)} onOpen={toggleProfile} size={40} />
            <div className="min-w-0 text-[14px]">
              <p className="flex flex-wrap items-center gap-x-1.5">
                <PersonName who={a} target={targetOf(a)} onOpen={toggleProfile} className="font-medium text-gray-900" />
                {!a.anonymous && roleLabel(a.role) && <span className="text-gray-500">· {roleLabel(a.role)}</span>}
              </p>
              <p className="mt-0.5 text-[13px] text-gray-500">{timeAgo(post.createdAt)} · {post.readingMinutes}분 · 조회 {post.viewCount.toLocaleString()}</p>
            </div>
          </div>
        </header>

        <div data-post-body className="mt-8 md:mt-10">
          <PostBody
            doc={doc}
            onOpenImage={(images, index) => setLightbox({ images, index })}
            poll={{ postId: post.id, view: post.poll ?? null, loggedIn: isAuthenticated, onNeedLogin: () => { requireLogin(); } }}
          />
        </div>

        <div className="mx-auto mt-12 max-w-[680px] md:mt-16">
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-6">
            <button
              type="button"
              onClick={() => !requireLogin() && like.mutate()}
              aria-pressed={post.liked}
              className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-[14px] font-medium ${post.liked ? 'border-accent text-accent' : 'border-gray-300 text-gray-700 hover:border-gray-500'}`}
            >
              <Heart size={17} className={post.liked ? 'fill-accent' : ''} />좋아요 {post.likeCount}
            </button>
            <button type="button" onClick={() => void share()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-300 px-4 text-[14px] font-medium text-gray-700 hover:border-gray-500">
              <Share2 size={17} />공유
            </button>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[14px] text-gray-500"><MessageCircle size={16} />댓글 {post.commentCount}</span>
          </div>

          {!a.anonymous && a.id != null && (
            <section aria-label="글쓴이" className="mt-8 flex flex-wrap items-center gap-4 bg-gray-50 p-5 md:p-6">
              <Avatar a={a} size={56} />
              <div className="min-w-0 flex-[1_1_200px]">
                <p className="text-[16px] font-semibold text-gray-900">{a.name}{roleLabel(a.role) && <span className="ml-1.5 text-[13px] font-normal text-gray-500">{roleLabel(a.role)}</span>}</p>
                {a.intro && <p className="mt-1 text-[14px] leading-relaxed text-gray-600">{a.intro}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!a.mine && <FollowButton userId={a.id} />}
                {authorHome && <Link to={authorHome} className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-[14px] font-medium text-gray-700 hover:border-gray-500">홈페이지</Link>}
              </div>
            </section>
          )}

          {/* 댓글 — 답글은 맨 위 댓글 아래 한 단계 */}
          <section id="comments" aria-label="댓글" className="mt-12 scroll-mt-28">
            <h2 className="text-[17px] font-semibold text-gray-900">댓글 {post.commentCount}</h2>
            <ul className="mt-2">
              {post.comments.map((c) => (
                <li key={c.id} className="border-t border-gray-100">
                  <CommentRow
                    c={c} postAuthorId={a.anonymous ? null : a.id} isAdmin={isAdmin} flash={flash === c.id}
                    target={targetOf(c.author)} onOpen={toggleProfile}
                    onReply={() => openReply(c.id, c.id, c.author)}
                    replying={reply?.to === c.id}
                    onDelete={() => removeComment.mutate(c.id)}
                  />
                  {(c.replies.length > 0 || reply?.thread === c.id) && (
                    <ul className="mb-3 ml-11 border-l border-gray-100 pl-4 md:ml-12" aria-label="답글">
                      {c.replies.map((r) => (
                        <li key={r.id}>
                          <CommentRow
                            c={r} small postAuthorId={a.anonymous ? null : a.id} isAdmin={isAdmin} flash={flash === r.id}
                            target={targetOf(r.author)} onOpen={toggleProfile}
                            onReply={() => openReply(r.id, c.id, r.author)}
                            replying={reply?.to === r.id}
                            onDelete={() => removeComment.mutate(r.id)}
                          />
                        </li>
                      ))}
                      {reply?.thread === c.id && (
                        <li className="py-3">
                          <ReplyBox
                            name={reply.name}
                            text={replyText}
                            onText={(v) => setReplyText(v.slice(0, 2000))}
                            anon={replyAnon}
                            onAnon={setReplyAnon}
                            pending={addReply.isPending}
                            onCancel={() => { setReply(null); setReplyText(''); }}
                            onSubmit={() => addReply.mutate(reply.to)}
                          />
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              ))}
              {post.comments.length === 0 && <li className="border-t border-gray-100 py-8 text-center text-[14px] text-gray-500">첫 댓글을 남겨 보세요.</li>}
            </ul>

            <div className="mt-2 border-t border-gray-100 pt-4">
              <label htmlFor="comment-input" className="sr-only">댓글</label>
              <textarea
                id="comment-input"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 2000))}
                onFocus={() => { if (!isAuthenticated) requireLogin(); }}
                rows={2}
                placeholder={isAuthenticated ? '댓글을 입력하세요' : '로그인하면 댓글을 남길 수 있어요'}
                readOnly={!isAuthenticated}
                className="w-full resize-none rounded-lg border border-gray-300 px-3.5 py-3 text-[15px] leading-relaxed focus:border-gray-900 focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[14px] text-gray-600">
                  <input type="checkbox" checked={anonComment} onChange={(e) => setAnonComment(e.target.checked)} className="h-4 w-4 accent-gray-900" /> 익명
                </label>
                <button
                  type="button"
                  onClick={() => !requireLogin() && addComment.mutate()}
                  disabled={!comment.trim() || addComment.isPending}
                  className="h-10 rounded-lg bg-gray-900 px-5 text-[14px] font-semibold text-white disabled:opacity-40"
                >
                  댓글 등록
                </button>
              </div>
            </div>
          </section>
        </div>

        {post.related.length > 0 && (
          <section aria-label={tab ? `${tab.name} 탭의 다른 글` : '다른 글'} className="mx-auto mt-16 max-w-[1040px] border-t border-gray-200 pt-10 md:mt-24">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-[17px] font-semibold text-gray-900">{tab ? `${tab.name}의 다른 글` : '다른 글'}</h2>
              <Link to={tab ? `/community?tab=${tab.slug}` : '/community'} className="text-[14px] text-gray-500 underline underline-offset-4 hover:text-gray-900">모두 보기</Link>
            </div>
            {/* 휴대폰은 한 줄(오른쪽 작은 사진) — 4:3 카드를 세 장 쌓으면 화면 세 개를 먹는다. 넓은 화면은 세 칸 */}
            <div className="mt-4 grid grid-cols-1 sm:mt-6 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-8">
              {post.related.map((r) => (
                <Link key={r.id} to={`/community/${r.id}`} className="group flex min-w-0 gap-4 border-b border-gray-100 py-4 sm:block sm:border-0 sm:py-0">
                  {r.cover ? (
                    <div className="order-2 aspect-[4/3] w-24 shrink-0 overflow-hidden bg-gray-100 sm:order-none sm:w-auto">
                      <Thumb src={r.cover} size="grid" alt="" loading="lazy" className="h-full w-full object-cover transition-opacity group-hover:opacity-80" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className={`${r.cover ? 'sm:mt-3' : ''} line-clamp-2 break-keep text-[16px] font-medium leading-snug text-gray-900 group-hover:underline [overflow-wrap:anywhere]`}>{r.title}</p>
                    {!r.cover && r.excerpt && <p className="mt-1.5 line-clamp-2 break-keep text-[14px] leading-relaxed text-gray-500 [overflow-wrap:anywhere] sm:line-clamp-3">{r.excerpt}</p>}
                    <p className="mt-2 text-[12px] text-gray-500">{r.author.name} · {r.readingMinutes}분</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>

      {profile && <ProfilePopover key={profile.target.id} target={profile.target} anchor={profile.el} onClose={closeProfile} />}

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

/* ── 댓글 한 줄 · 답글 칸 ── */

type OpenProfile = (el: HTMLElement, t: ProfileTarget) => void;

/** 이름 — 실명이면 누르면 프로필 카드, 익명이면 그냥 글자 */
function PersonName({ who, target, onOpen, className = '' }: { who: Author; target: ProfileTarget | null; onOpen: OpenProfile; className?: string }) {
  if (!target) return <span className={className}>{who.name}</span>;
  return (
    <button type="button" onClick={(e) => onOpen(e.currentTarget, target)} aria-haspopup="dialog" className={`${className} rounded-sm text-left underline-offset-4 hover:underline`}>
      {who.name}
    </button>
  );
}
/** 사진 — 이름과 같이 프로필 카드를 연다 */
function PersonFace({ who, target, onOpen, size }: { who: Author; target: ProfileTarget | null; onOpen: OpenProfile; size: number }) {
  if (!target) return <Avatar a={who} size={size} />;
  return (
    <button type="button" onClick={(e) => onOpen(e.currentTarget, target)} aria-label={`${who.name} 프로필`} aria-haspopup="dialog" className="h-fit shrink-0 rounded-full">
      <Avatar a={who} size={size} />
    </button>
  );
}

function CommentRow({ c, small = false, postAuthorId, isAdmin, flash, target, onOpen, onReply, replying, onDelete }: {
  c: Comment | Reply; small?: boolean; postAuthorId: number | null; isAdmin: boolean; flash: boolean;
  target: ProfileTarget | null; onOpen: OpenProfile; onReply: () => void; replying: boolean; onDelete: () => void;
}) {
  const replyTo = 'replyTo' in c ? c.replyTo : null;
  if (c.deleted || !c.author) {
    return (
      <div data-comment-id={c.id} className={`scroll-mt-28 ${small ? 'py-3' : 'py-4'}`}>
        <p className="text-[14px] text-gray-400">삭제된 댓글입니다.</p>
      </div>
    );
  }
  const who = c.author;
  return (
    <div data-comment-id={c.id} className={`flex scroll-mt-28 gap-3 transition-colors duration-700 ${small ? 'py-3' : 'py-4'} ${flash ? 'bg-gray-100' : 'bg-transparent'}`}>
      <PersonFace who={who} target={target} onOpen={onOpen} size={small ? 28 : 32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[13px]">
          <PersonName who={who} target={target} onOpen={onOpen} className="font-semibold text-gray-900" />
          {!who.anonymous && roleLabel(who.role) && <span className="text-gray-500">· {roleLabel(who.role)}</span>}
          {!who.anonymous && postAuthorId != null && who.id === postAuthorId && <span className="text-[11px] font-semibold text-accent">글쓴이</span>}
          <span className="text-gray-500">· {timeAgo(c.createdAt)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-keep text-[15px] leading-[1.7] text-gray-700 [overflow-wrap:anywhere]">
          {replyTo && <span className="mr-1.5 font-medium text-gray-900">{replyTo.name}님에게</span>}
          {c.body}
        </p>
        <div className="-ml-2 mt-1 flex items-center">
          <button type="button" onClick={onReply} aria-expanded={replying} className={`h-8 rounded-md px-2 text-[13px] font-medium hover:bg-gray-100 ${replying ? 'text-gray-900' : 'text-gray-500'}`}>답글</button>
          {(who.mine || isAdmin) && (
            <button type="button" onClick={onDelete} title={who.mine ? '삭제' : '댓글 삭제 (관리자)'} className="h-8 rounded-md px-2 text-[13px] text-gray-400 hover:bg-gray-100 hover:text-accent">삭제</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyBox({ name, text, onText, anon, onAnon, pending, onCancel, onSubmit }: {
  name: string; text: string; onText: (v: string) => void; anon: boolean; onAnon: (v: boolean) => void;
  pending: boolean; onCancel: () => void; onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: false }); }, []);
  return (
    <div>
      <label htmlFor="reply-input" className="block text-[13px] font-medium text-gray-700">{name ? `${name}님에게 답글` : '답글'}</label>
      <textarea
        id="reply-input"
        ref={ref}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        rows={2}
        placeholder="답글을 입력하세요"
        className="mt-1.5 w-full resize-none rounded-lg border border-gray-300 px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-gray-900 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[14px] text-gray-600">
          <input type="checkbox" checked={anon} onChange={(e) => onAnon(e.target.checked)} className="h-4 w-4 accent-gray-900" /> 익명
        </label>
        <span className="flex gap-1.5">
          <button type="button" onClick={onCancel} className="h-10 rounded-lg px-3 text-[14px] text-gray-600 hover:bg-gray-100">취소</button>
          <button type="button" onClick={onSubmit} disabled={!text.trim() || pending} className="h-10 rounded-lg bg-gray-900 px-4 text-[14px] font-semibold text-white disabled:opacity-40">답글 등록</button>
        </span>
      </div>
    </div>
  );
}
