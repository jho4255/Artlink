import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Eye, PenLine, Settings2, Pin, PinOff, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TabManager, { type CommunityTab } from '@/components/community/TabManager';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo } from '@/lib/utils';

/**
 * 커뮤니티 (Community) — 블라인드식 글로벌 게시판.
 *   · 글마다 실명(닉네임+역할)/익명 선택
 *   · 최신 / 인기 정렬
 *   · **탭(말머리)은 Admin 이 만든다** — 전체 + 관리자가 추가한 탭들
 *   · 읽기는 누구나, 쓰기는 로그인
 *
 * ## Admin 전용 (2026-09-04)
 * 탭 만들기·순서·숨김·삭제 / 공지 지정 / 고정 / **남의 글 삭제**.
 * ⚠️ 삭제는 서버가 원래 작성자·Admin 둘 다 허용했는데 **화면이 `author.mine` 일 때만**
 *    버튼을 그렸다. 그래서 관리자가 신고받은 글을 못 지웠다 — 권한은 있는데 손이 닿지 않았다.
 * ⚠️ 화면에서 감추는 것만으로는 권한이 아니다. 공지·고정·탭은 **서버가 role 로** 막는다.
 */
interface PostAuthor { name: string; role: string | null; anonymous: boolean; mine: boolean }
interface PostRow {
  id: number; title: string; excerpt: string;
  thumbnail: string | null; imageCount: number;
  likeCount: number; commentCount: number; viewCount: number; createdAt: string;
  notice: boolean; pinned: boolean;
  category: { id: number; name: string; slug: string } | null;
  author: PostAuthor;
}

const roleLabel = (role: string | null) =>
  role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'ADMIN' ? '운영' : '';
const authorLine = (a: PostAuthor) =>
  a.anonymous ? '익명' : `${a.name}${roleLabel(a.role) ? ` · ${roleLabel(a.role)}` : ''}`;

type Scope = 'all' | 'mine' | 'commented';

export default function CommunityPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');
  const [scope, setScope] = useState<Scope>('all');
  const [tab, setTab] = useState<string>('');           // '' = 전체, slug = 그 탭
  const [manageOpen, setManageOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<PostRow | null>(null);

  const { data: tabs } = useQuery<CommunityTab[]>({
    queryKey: ['community-tabs'],
    queryFn: () => api.get('/community/categories').then((r) => r.data),
  });

  const { data, isLoading } = useQuery<{ posts: PostRow[] }>({
    queryKey: ['community', sort, scope, tab],
    queryFn: () => api.get('/community', {
      params: {
        sort,
        ...(tab ? { category: tab } : {}),
        ...(scope === 'mine' ? { mine: 'posts' } : scope === 'commented' ? { mine: 'comments' } : {}),
      },
    }).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['community'] });
    qc.invalidateQueries({ queryKey: ['community-popular'] });
  };
  const togglePin = useMutation({
    mutationFn: (p: PostRow) => api.patch(`/community/${p.id}/pin`, { pinned: !p.pinned }),
    onSuccess: (_r, p) => { invalidate(); toast.success(p.pinned ? '고정을 해제했습니다.' : '맨 위에 고정했습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '고정 변경 실패'),
  });
  const removePost = useMutation({
    mutationFn: (id: number) => api.delete(`/community/${id}`),
    onSuccess: () => { invalidate(); setDelTarget(null); toast.success('글을 삭제했습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제 실패'),
  });

  const goWrite = () => isAuthenticated ? navigate('/community/write') : (toast.error('로그인이 필요합니다.'), navigate('/login'));

  // 내 글·내 댓글·글쓰기 — 같은 알약 모양으로 통일. 필터는 켜지면 진하게, 글쓰기는 옅은 빨강 포인트.
  const pill = 'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs md:text-sm transition-colors';
  const filterBtn = (s: Scope, label: string) => (
    <button
      onClick={() => setScope((cur) => (cur === s ? 'all' : s))}
      className={`${pill} ${scope === s ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
    >
      {label}
    </button>
  );

  const visibleTabs = (tabs ?? []).filter((t) => t.active || isAdmin);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8 md:py-12">
      {/* 탭(말머리) — Admin 이 만든 것. 없으면 줄째로 안 그린다(빈 띠를 남기지 않는다) */}
      {(visibleTabs.length > 0 || isAdmin) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setTab('')}
            className={`${pill} ${tab === '' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            전체
          </button>
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.slug)}
              title={t.active ? undefined : '숨긴 탭 (관리자에게만 보입니다)'}
              className={`${pill} ${tab === t.slug ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'} ${t.active ? '' : 'opacity-50'}`}
            >
              {t.name}
            </button>
          ))}
          {isAdmin && (
            <button
              onClick={() => setManageOpen(true)}
              className={`${pill} border-dashed border-gray-300 text-gray-400 hover:bg-gray-50`}
              title="탭 관리 (관리자)"
            >
              <Settings2 size={13} /> 탭 관리
            </button>
          )}
        </div>
      )}

      {/* 상단 — 좌: 정렬 / 우: 내 글·내 댓글·글쓰기 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-y-3 border-b border-gray-200 pb-3">
        <div className="flex gap-4">
          {(['recent', 'popular'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-sm ${sort === s ? 'font-semibold text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}
            >
              {s === 'recent' ? '최신' : '인기'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isAuthenticated && filterBtn('mine', '내 글')}
          {isAuthenticated && filterBtn('commented', '내 댓글')}
          <button onClick={goWrite} className={`${pill} border-[#dc3545]/40 font-medium text-[#dc3545] hover:bg-[#dc3545]/5`}>
            <PenLine size={13} /> 글쓰기
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded bg-gray-100" />)}</div>
      ) : (data?.posts.length ?? 0) === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">
          {scope === 'mine' ? '작성한 글이 없습니다.' : scope === 'commented' ? '댓글을 단 글이 없습니다.' : '아직 글이 없습니다. 첫 글을 남겨보세요.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data!.posts.map((p) => (
            <li key={p.id} className={`group relative ${p.pinned ? 'bg-amber-50/40' : ''}`}>
              <button onClick={() => navigate(`/community/${p.id}`)} className="flex w-full items-start gap-3 py-4 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-1.5 text-base font-medium text-gray-900">
                    {p.notice && <span className="shrink-0 rounded bg-[#c4302b] px-1.5 py-0.5 text-[10px] font-semibold text-white">공지</span>}
                    {p.pinned && <Pin size={12} className="shrink-0 text-amber-600" aria-label="고정됨" />}
                    {/* 탭 배지 — 전체 보기에서만. ⚠️ 공지 배지와 **같은 글자면 안 그린다**
                        (관리자가 탭 이름을 '공지'로 지으면 한 줄에 '공지'가 두 번 떠 고장처럼 보인다) */}
                    {p.category && !tab && !(p.notice && p.category.name === '공지') && (
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{p.category.name}</span>
                    )}
                    <span className="truncate">{p.title}</span>
                  </h3>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">{p.excerpt}</p>
                  {/* 조회수·좋아요·댓글은 항상 같은 자리(작성자·시각 다음)에 — 썸네일이 있어도 밀리지 않게 ml-auto 안 씀 */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                    <span>{authorLine(p.author)}</span>
                    <span>·</span>
                    <span>{timeAgo(p.createdAt)}</span>
                    <span className="flex items-center gap-0.5"><Eye size={12} /> {p.viewCount}</span>
                    <span className="flex items-center gap-0.5"><Heart size={12} /> {p.likeCount}</span>
                    <span className="flex items-center gap-0.5"><MessageCircle size={12} /> {p.commentCount}</span>
                  </div>
                </div>
                {p.thumbnail && (
                  <Thumb src={p.thumbnail} size="list" alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                )}
              </button>

              {/* 관리자 조작 — 목록에서 바로. 카드 클릭(상세 이동)과 겹치지 않게 버튼을 위에 띄운다 */}
              {isAdmin && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => togglePin.mutate(p)}
                    title={p.pinned ? '고정 해제' : '맨 위에 고정'}
                    className="rounded-md bg-white/90 p-1.5 text-gray-500 shadow-sm ring-1 ring-gray-200 hover:text-amber-600"
                  >
                    {p.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                  <button
                    onClick={() => setDelTarget(p)}
                    title="글 삭제 (관리자)"
                    className="rounded-md bg-white/90 p-1.5 text-gray-500 shadow-sm ring-1 ring-gray-200 hover:text-[#c4302b]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {manageOpen && <TabManager tabs={tabs ?? []} onClose={() => setManageOpen(false)} />}
      <ConfirmDialog
        open={!!delTarget}
        title="글 삭제"
        message={`“${delTarget?.title ?? ''}” 글을 삭제하시겠습니까? 댓글도 함께 사라집니다.`}
        confirmText="삭제"
        onConfirm={() => delTarget && removePost.mutate(delTarget.id)}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}
