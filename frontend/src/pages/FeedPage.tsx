import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ImagePlus, X, Loader2, Trash2, Globe, Users, Heart, MessageCircle, Send, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo } from '@/lib/utils';

/**
 * 소식 (Story Feed) — 커뮤니티(글로벌 게시판)와 **다른** 개인 피드.
 *   · 내가 이웃(팔로우)한 사람 + 나 의 스토리만 최신순으로 모인다.
 *   · 공개범위는 **글마다** — 전체공개 | 이웃공개. 이웃공개는 내 이웃에게만.
 *   · 상단 인라인 작성(작업 중 사진 + 짧은 글). 익명 없음 — 소식은 '누가' 가 핵심.
 */
interface StoryAuthor { id: number; name: string; avatar: string | null; role: string }
interface Story {
  id: number; caption: string; images: string[]; visibility: 'PUBLIC' | 'NEIGHBORS';
  createdAt: string; author: StoryAuthor; mine: boolean;
  likeCount: number; commentCount: number; liked: boolean;
}
interface StoryComment { id: number; body: string; createdAt: string; author: StoryAuthor; mine: boolean }
interface FeedPage { stories: Story[]; page: number; hasMore: boolean; followingCount: number }

const roleLabel = (role: string) => (role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'ADMIN' ? '운영' : '');

function Composer() {
  const qc = useQueryClient();
  const [caption, setCaption] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'PUBLIC' | 'NEIGHBORS'>('NEIGHBORS');
  const [uploading, setUploading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // 멘션 사용자 검색
  const { data: mentionUsers } = useQuery<StoryAuthor[]>({
    queryKey: ['mention-users', mentionQuery],
    queryFn: () => mentionQuery ? api.get('/users/search', { params: { q: mentionQuery } }).then(r => r.data) : Promise.resolve([]),
    enabled: mentionQuery.length > 0,
  });

  const handleCaptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setCaption(text);
    // @ 이후의 텍스트 추출
    const match = text.match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : '');
  };

  const insertMention = (user: StoryAuthor) => {
    const parts = caption.split(/@\w*$/);
    setCaption(parts[0] + `@${user.nickname || user.name} `);
    setMentionQuery('');
  };

  const create = useMutation({
    mutationFn: () => api.post('/stories', { caption: caption.trim(), images, visibility }).then((r) => r.data),
    onSuccess: () => {
      setCaption(''); setImages([]); setVisibility('NEIGHBORS');
      qc.invalidateQueries({ queryKey: ['story-feed'] });
      toast.success('소식을 올렸어요.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '올리기에 실패했습니다.'),
  });

  const onPickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const room = 10 - images.length;
    if (room <= 0) { toast.error('사진은 10장까지입니다.'); return; }
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, room)) {
        if (file.size > 15 * 1024 * 1024) { toast.error('사진은 최대 15MB 까지입니다.'); continue; }
        const form = new FormData();
        form.append('image', file);
        const { data } = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        urls.push(data.url);
      }
      setImages((prev) => [...prev, ...urls]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || '사진 업로드 실패');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSubmit = (!!caption.trim() || images.length > 0) && !create.isPending && !uploading;

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="relative">
        <textarea
          value={caption}
          onChange={(e) => {
            const text = e.target.value.slice(0, 1000);
            handleCaptionChange({ ...e, target: { ...e.target, value: text } } as any);
          }}
          placeholder="작업 소식을 남겨보세요. @를 쳐서 사람을 멘션할 수 있습니다."
          className="min-h-[72px] w-full resize-none text-[15px] leading-relaxed text-gray-800 placeholder:text-gray-300 focus:outline-none [overflow-wrap:anywhere]"
        />
        {/* 멘션 자동완성 */}
        {mentionQuery && mentionUsers && mentionUsers.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-md z-10">
            {mentionUsers.slice(0, 5).map(u => (
              <button key={u.id} onClick={() => insertMention(u)}
                className="block w-full px-3 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg">
                @{u.nickname || u.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((url, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-lg border border-gray-100">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                aria-label="사진 삭제"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || images.length >= 10}
          aria-label="사진 첨부"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
        </button>

        {/* 공개범위 — 전체공개 / 이웃공개 */}
        <button
          onClick={() => setVisibility((v) => (v === 'PUBLIC' ? 'NEIGHBORS' : 'PUBLIC'))}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          {visibility === 'PUBLIC' ? <><Globe size={14} /> 전체공개</> : <><Users size={14} /> 이웃공개</>}
        </button>

        <button
          onClick={() => create.mutate()}
          disabled={!canSubmit}
          className={`ml-auto rounded-full px-5 py-1.5 text-sm font-semibold ${canSubmit ? 'bg-gray-950 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-300'}`}
        >
          {create.isPending ? '올리는 중…' : '올리기'}
        </button>
      </div>
    </div>
  );
}

function StoryCard({ story }: { story: Story }) {
  const qc = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [showComments, setShowComments] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const a = story.author;

  // 본인의 하이라이트 목록
  const { data: myHighlights } = useQuery<any[]>({
    queryKey: ['my-highlights'],
    queryFn: () => user?.id ? api.get(`/stories/highlights/${user.id}`).then((r) => r.data) : Promise.resolve([]),
    enabled: showHighlightPicker && !!user?.id,
  });

  // 멘션 사용자 검색
  const { data: mentionUsers } = useQuery<StoryAuthor[]>({
    queryKey: ['mention-users', mentionQuery],
    queryFn: () => mentionQuery ? api.get('/users/search', { params: { q: mentionQuery } }).then(r => r.data) : Promise.resolve([]),
    enabled: mentionQuery.length > 0,
  });

  const handleCommentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setCommentText(text);
    const match = text.match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : '');
  };

  const insertMention = (u: StoryAuthor) => {
    const parts = commentText.split(/@\w*$/);
    setCommentText(parts[0] + `@${u.nickname || u.name} `);
    setMentionQuery('');
  };

  // 스토리를 하이라이트에 추가
  const addToHighlight = useMutation({
    mutationFn: (highlightId: number) => api.post(`/stories/highlights/${highlightId}/stories/${story.id}`),
    onSuccess: () => { toast.success('하이라이트에 추가했어요.'); setShowHighlightPicker(false); },
    onError: (e: any) => toast.error(e.response?.data?.error || '추가 실패'),
  });

  const { data: likers } = useQuery<StoryAuthor[]>({
    queryKey: ['story-likers', story.id],
    queryFn: () => api.get(`/stories/${story.id}/likers`).then((r) => r.data),
    enabled: showLikers && story.likeCount > 0,
  });

  const patchFeed = (fn: (s: Story) => Story) => {
    qc.setQueryData<{ pages: FeedPage[]; pageParams: unknown[] }>(['story-feed'], (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, stories: p.stories.map((s) => (s.id === story.id ? fn(s) : s)) })) } : old);
  };

  const del = useMutation({
    mutationFn: () => api.delete(`/stories/${story.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['story-feed'] }); toast.success('삭제했어요.'); },
    onError: () => toast.error('삭제에 실패했습니다.'),
  });

  const like = useMutation({
    mutationFn: () => api.post(`/stories/${story.id}/like`).then((r) => r.data),
    onMutate: () => { patchFeed((s) => ({ ...s, liked: !s.liked, likeCount: s.likeCount + (s.liked ? -1 : 1) })); },
    onError: () => { patchFeed((s) => ({ ...s, liked: !s.liked, likeCount: s.likeCount + (s.liked ? -1 : 1) })); toast.error('잠시 후 다시 시도해주세요.'); },
    onSuccess: (d) => patchFeed((s) => ({ ...s, liked: d.liked, likeCount: d.likeCount })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['story-likers', story.id] }),
  });

  const { data: comments } = useQuery<StoryComment[]>({
    queryKey: ['story-comments', story.id],
    queryFn: () => api.get(`/stories/${story.id}/comments`).then((r) => r.data),
    enabled: showComments,
  });

  const addComment = useMutation({
    mutationFn: () => api.post(`/stories/${story.id}/comments`, { body: commentText.trim() }).then((r) => r.data),
    onSuccess: () => { setCommentText(''); qc.invalidateQueries({ queryKey: ['story-comments', story.id] }); patchFeed((s) => ({ ...s, commentCount: s.commentCount + 1 })); },
    onError: (e: any) => toast.error(e.response?.data?.error || '댓글 등록 실패'),
  });

  const delComment = useMutation({
    mutationFn: (id: number) => api.delete(`/stories/${story.id}/comments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['story-comments', story.id] }); patchFeed((s) => ({ ...s, commentCount: Math.max(0, s.commentCount - 1) })); },
  });

  const onLike = () => { if (!isAuthenticated) { toast.error('로그인이 필요합니다.'); return; } like.mutate(); };

  return (
    <article className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-center gap-3">
        <Link to={`/portfolio/${a.id}`} className="shrink-0">
          {a.avatar
            ? <img src={a.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
            : <div className="grid h-9 w-9 place-items-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">{a.name.slice(0, 1)}</div>}
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/portfolio/${a.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
            {a.name}{roleLabel(a.role) && <span className="ml-1 text-xs font-normal text-gray-400">· {roleLabel(a.role)}</span>}
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>{timeAgo(story.createdAt)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-0.5">
              {story.visibility === 'PUBLIC' ? <><Globe size={11} /> 전체</> : <><Users size={11} /> 이웃</>}
            </span>
          </div>
        </div>
        {story.mine && (
          <button onClick={() => del.mutate()} disabled={del.isPending} aria-label="삭제" className="text-gray-300 hover:text-red-500">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {story.caption && (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{story.caption}</p>
      )}

      {story.images.length > 0 && (
        <div className={`mt-3 grid gap-1.5 ${story.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {story.images.map((url, i) => (
            <Thumb key={i} src={url} size="grid" alt="" loading="lazy"
              className={`w-full rounded-lg border border-gray-100 object-cover ${story.images.length === 1 ? 'max-h-[70vh] object-contain' : 'aspect-square'}`} />
          ))}
        </div>
      )}

      {/* 좋아요 · 댓글 · 하이라이트 */}
      <div className="mt-3 flex items-center gap-4 border-t border-gray-50 pt-2.5 text-sm">
        <button onClick={onLike} className={`inline-flex items-center gap-1 ${story.liked ? 'text-[#dc3545]' : 'text-gray-500 hover:text-gray-800'}`}>
          <Heart size={16} className={story.liked ? 'fill-[#dc3545]' : ''} /> {story.likeCount > 0 && story.likeCount}
        </button>
        <button onClick={() => setShowComments((v) => !v)} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
          <MessageCircle size={16} /> {story.commentCount > 0 && story.commentCount}
        </button>
        {story.mine && isAuthenticated && (
          <button onClick={() => setShowHighlightPicker((v) => !v)} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
            ⭐ 하이라이트
          </button>
        )}
        {story.likeCount > 0 && (
          <button onClick={() => setShowLikers((v) => !v)} className="ml-auto text-xs text-gray-400 hover:text-gray-700">
            좋아요 누른 사람
          </button>
        )}
      </div>

      {/* 하이라이트 선택 */}
      {showHighlightPicker && (
        <div className="mt-2 rounded-lg bg-gray-50 p-2.5">
          {myHighlights && myHighlights.length > 0 ? (
            <div className="space-y-1">
              {myHighlights.map(h => (
                <button key={h.id} onClick={() => addToHighlight.mutate(h.id)}
                  className="block w-full text-left rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-200"
                  disabled={addToHighlight.isPending}>
                  {h.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">하이라이트가 없습니다. 프로필 편집에서 만들어보세요.</p>
          )}
        </div>
      )}

      {showLikers && story.likeCount > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 rounded-lg bg-gray-50 p-2.5">
          {(likers ?? []).map((u) => (
            <Link key={u.id} to={`/portfolio/${u.id}`} className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900">
              {u.avatar
                ? <img src={u.avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                : <span className="grid h-5 w-5 place-items-center rounded-full bg-gray-200 text-[9px] font-semibold text-gray-500">{u.name.slice(0, 1)}</span>}
              {u.name}
            </Link>
          ))}
          {!likers && <span className="text-xs text-gray-400">불러오는 중…</span>}
        </div>
      )}

      {showComments && (
        <div className="mt-3 space-y-3 border-t border-gray-50 pt-3">
          {(comments ?? []).map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm">
              <Link to={`/portfolio/${c.author.id}`} className="shrink-0">
                {c.author.avatar
                  ? <img src={c.author.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                  : <div className="grid h-6 w-6 place-items-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500">{c.author.name.slice(0, 1)}</div>}
              </Link>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-semibold text-gray-700">{c.author.name}</span>
                <span className="ml-1.5 text-[11px] text-gray-300">{timeAgo(c.createdAt)}</span>
                <p className="whitespace-pre-wrap text-[13px] leading-snug text-gray-800 [overflow-wrap:anywhere]">{c.body}</p>
              </div>
              {(c.mine || story.mine) && (
                <button onClick={() => delComment.mutate(c.id)} aria-label="댓글 삭제" className="text-gray-300 hover:text-red-500"><X size={13} /></button>
              )}
            </div>
          ))}
          {isAuthenticated && (
            <div className="space-y-1">
              <div className="relative flex items-center gap-2">
                <input
                  value={commentText}
                  onChange={handleCommentChange}
                  onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim()) addComment.mutate(); }}
                  placeholder="댓글 달기… (@를 쳐서 멘션)"
                  className="min-w-0 flex-1 rounded-full border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
                <button onClick={() => commentText.trim() && addComment.mutate()} disabled={!commentText.trim() || addComment.isPending}
                  aria-label="댓글 등록" className="text-gray-500 hover:text-gray-900 disabled:text-gray-300"><Send size={16} /></button>
                {/* 멘션 자동완성 */}
                {mentionQuery && mentionUsers && mentionUsers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-md z-10 max-h-40 overflow-y-auto">
                    {mentionUsers.slice(0, 5).map(u => (
                      <button key={u.id} onClick={() => insertMention(u)}
                        className="block w-full px-3 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg">
                        @{u.nickname || u.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function FeedPage() {
  const { isAuthenticated, user } = useAuthStore();
  const qc = useQueryClient();
  const [showHighlightModal, setShowHighlightModal] = useState(false);
  const [highlightName, setHighlightName] = useState('');
  const [highlightIsPublic, setHighlightIsPublic] = useState(true);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['story-feed'],
    queryFn: ({ pageParam = 1 }) => api.get('/stories/feed', { params: { page: pageParam } }).then((r) => r.data as FeedPage),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: isAuthenticated,
  });

  // 로그인한 사용자의 하이라이트 불러오기
  const { data: myHighlights } = useQuery<any[]>({
    queryKey: ['my-highlights'],
    queryFn: () => user?.id ? api.get(`/stories/highlights/${user.id}`).then(r => r.data) : Promise.resolve([]),
    enabled: !!user?.id,
  });

  const createHighlight = useMutation({
    mutationFn: (data: { name: string; isPublic: boolean }) =>
      api.post('/stories/highlights', data).then(r => r.data),
    onSuccess: () => {
      setHighlightName('');
      setShowHighlightModal(false);
      qc.invalidateQueries({ queryKey: ['my-highlights'] });
      toast.success('하이라이트가 생성되었습니다.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '생성에 실패했습니다.'),
  });

  const stories = data?.pages.flatMap((p) => p.stories) ?? [];
  const followingCount = data?.pages[0]?.followingCount ?? 0;

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-gray-500">소식은 로그인 후 볼 수 있습니다.</p>
        <Link to="/login" className="mt-3 inline-block rounded-lg bg-gray-950 px-4 py-2 text-sm text-white">로그인</Link>
      </div>
    );
  }

  // 바깥 컨테이너는 다른 페이지와 같은 max-w-7xl px-6 md:px-12 —
  // 제목(ArtStory) 왼쪽 끝이 Navbar 의 ArtLink 로고와 정확히 맞게. 피드 본문만 좁게(max-w-2xl) 왼쪽 정렬.
  return (
    <div className="py-8 md:py-12">
      {/* 제목(ArtStory) 왼쪽 끝은 Navbar 의 ArtLink 로고와 맞춘다(max-w-7xl 왼쪽 끝) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12 mb-6">
        <h1 className="text-xl font-bold tracking-tight font-serif text-gray-900 md:text-2xl">
          Art<span className="text-[#dc3545]">Story</span>
        </h1>
      </div>

      {/* 본문은 보는 화면 기준 가운데 정렬(max-w-2xl mx-auto) */}
      <div className="max-w-2xl mx-auto px-6">
        {/* 하이라이트 앨범 */}
        {myHighlights && (myHighlights.length > 0 || isAuthenticated) && (
          <div className="mb-6 pb-6 border-b border-gray-100">
            <div className="flex items-center gap-3 flex-wrap">
              {/* "+" 버튼 — 새 하이라이트 생성 */}
              {isAuthenticated && (
                <button
                  onClick={() => setShowHighlightModal(true)}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div className="h-16 w-16 rounded-full border-2 border-gray-300 border-dashed flex items-center justify-center hover:border-gray-400 hover:bg-gray-50 transition">
                    <Plus size={20} className="text-gray-400" />
                  </div>
                  <span className="text-xs text-gray-500">추가</span>
                </button>
              )}
              {/* 하이라이트 앨범 */}
              {myHighlights?.map(h => (
                <div key={h.id} className="flex flex-col items-center gap-1.5">
                  <button
                    className="h-16 w-16 rounded-full border-2 border-gray-200 overflow-hidden hover:border-gray-400 bg-gray-100"
                    title={h.name}
                  >
                    {h.coverImage ? (
                      <img src={h.coverImage} alt={h.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-300 to-gray-400 text-white text-xs font-bold">
                        {h.name.slice(0, 2)}
                      </div>
                    )}
                  </button>
                  <span className="text-xs text-gray-600 text-center max-w-16 truncate">{h.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 새 하이라이트 생성 모달 */}
        {showHighlightModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHighlightModal(false)}>
            <div className="bg-white rounded-lg shadow-lg p-6 w-96 max-w-full mx-3" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-4">새 하이라이트</h2>
              <input
                type="text"
                value={highlightName}
                onChange={e => setHighlightName(e.target.value)}
                placeholder="하이라이트 이름"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-400 mb-4"
              />
              <label className="flex items-center gap-2 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={highlightIsPublic}
                  onChange={e => setHighlightIsPublic(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-600">공개</span>
              </label>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowHighlightModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    if (highlightName.trim()) {
                      createHighlight.mutate({ name: highlightName.trim(), isPublic: highlightIsPublic });
                    } else {
                      toast.error('하이라이트 이름을 입력하세요.');
                    }
                  }}
                  disabled={!highlightName.trim() || createHighlight.isPending}
                  className="px-4 py-2 text-sm bg-gray-950 text-white hover:bg-gray-900 disabled:opacity-50 rounded-lg"
                >
                  {createHighlight.isPending ? '생성 중...' : '생성'}
                </button>
              </div>
            </div>
          </div>
        )}

        <Composer />

        {isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />)}</div>
        ) : stories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
            <p className="text-sm text-gray-500">
              {followingCount === 0
                ? '관심 있는 작가를 이웃으로 추가하면 여기에 소식이 모입니다.'
                : '아직 올라온 소식이 없습니다. 첫 소식을 남겨보세요.'}
            </p>
            <Link to="/explore" className="mt-3 inline-block text-sm font-medium text-[#dc3545] hover:underline">작가 둘러보기 →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {stories.map((s) => <StoryCard key={s.id} story={s} />)}
            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full rounded-lg border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
              >
                {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
