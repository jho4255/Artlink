import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Eye, ArrowRight } from 'lucide-react';
import api from '@/lib/axios';
import { timeAgo } from '@/lib/utils';

/**
 * 홈 좌측 — 커뮤니티 인기글.
 * 익명 글은 작성자 신원이 서버에서 가려져 내려온다(`author.anonymous`).
 */
interface PopularPost {
  id: number;
  title: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createdAt: string;
  author: { name: string; role: string | null; anonymous: boolean };
}

const roleLabel = (role: string | null) =>
  role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'ADMIN' ? '운영' : '';

export default function PopularPosts() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery<PopularPost[]>({
    queryKey: ['community-popular'],
    queryFn: () => api.get('/community/popular', { params: { limit: 6 } }).then((r) => r.data),
  });

  return (
    <section>
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-lg font-serif text-gray-900">인기글</h2>
        <Link to="/community" className="flex items-center gap-0.5 text-sm text-gray-500 hover:text-gray-900">
          더보기 <ArrowRight size={13} />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />)}</div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
          아직 글이 없습니다.
          <button onClick={() => navigate('/community')} className="mt-2 block w-full text-gray-900 underline underline-offset-4">
            첫 글 남기기
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.map((p, i) => (
            <li key={p.id}>
              <button
                onClick={() => navigate(`/community/${p.id}`)}
                className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="w-5 shrink-0 text-center text-sm font-semibold text-gray-300">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{p.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-gray-400">
                    {p.author.anonymous ? '익명' : `${p.author.name}${roleLabel(p.author.role) ? ` · ${roleLabel(p.author.role)}` : ''}`}
                    {' · '}{timeAgo(p.createdAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
                  <span className="flex items-center gap-0.5"><Eye size={12} /> {p.viewCount}</span>
                  <span className="flex items-center gap-0.5"><Heart size={12} /> {p.likeCount}</span>
                  <span className="flex items-center gap-0.5"><MessageCircle size={12} /> {p.commentCount}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
