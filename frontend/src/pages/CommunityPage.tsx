import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Eye, PenLine } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo } from '@/lib/utils';

/**
 * 커뮤니티 (Community) — 블라인드식 글로벌 게시판.
 *   · 글마다 실명(닉네임+역할)/익명 선택
 *   · 최신 / 인기 정렬
 *   · 읽기는 누구나, 쓰기는 로그인
 */
interface PostAuthor { name: string; role: string | null; anonymous: boolean }
interface PostRow {
  id: number; title: string; excerpt: string;
  thumbnail: string | null; imageCount: number;
  likeCount: number; commentCount: number; viewCount: number; createdAt: string; author: PostAuthor;
}

const roleLabel = (role: string | null) =>
  role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'ADMIN' ? '운영' : '';
const authorLine = (a: PostAuthor) =>
  a.anonymous ? '익명' : `${a.name}${roleLabel(a.role) ? ` · ${roleLabel(a.role)}` : ''}`;

type Scope = 'all' | 'mine' | 'commented';

export default function CommunityPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');
  const [scope, setScope] = useState<Scope>('all');

  const { data, isLoading } = useQuery<{ posts: PostRow[] }>({
    queryKey: ['community', sort, scope],
    queryFn: () => api.get('/community', {
      params: { sort, ...(scope === 'mine' ? { mine: 'posts' } : scope === 'commented' ? { mine: 'comments' } : {}) },
    }).then((r) => r.data),
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8 md:py-12">
      {/* 상단 — 좌: 정렬 / 우: 내 글·내 댓글·글쓰기 (제목은 없앰) */}
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
            <li key={p.id}>
              <button onClick={() => navigate(`/community/${p.id}`)} className="flex w-full items-start gap-3 py-4 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-medium text-gray-900">{p.title}</h3>
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
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
