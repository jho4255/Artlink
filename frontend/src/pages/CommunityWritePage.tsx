import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

/**
 * 커뮤니티 글쓰기 — `/community/write`(새 글) · `/community/:id/edit`(고치기). **Layout 밖** 전용 화면(App.tsx).
 *
 * 편집기(TipTap + 사진 도구, components/post-editor)는 이 화면에서만 받는다 — 읽는 사람은 받지 않는다(vite.config.ts 가
 * PWA 미리받기에서도 뺀다). 새 배포로 청크 이름이 바뀌어 옛 청크가 404 면 한 번만 새로고침한다 — 이때는 아직 아무것도 안 쓴 상태다.
 */
const PostEditor = lazy(() =>
  import('@/components/post-editor/PostEditor').catch((err) => {
    const KEY = 'chunk-reload-at';
    const now = Date.now();
    if (now - Number(sessionStorage.getItem(KEY) || 0) > 15000) {
      sessionStorage.setItem(KEY, String(now));
      window.location.reload();
      return new Promise<never>(() => {});
    }
    throw err;
  }),
);

export default function CommunityWritePage() {
  const { id } = useParams<{ id?: string }>();
  const n = id ? Number(id) : NaN;
  const postId = Number.isInteger(n) && n > 0 ? n : null;
  return (
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-white"><Loader2 size={22} className="animate-spin text-gray-400" /></div>}>
      <PostEditor postId={postId} />
    </Suspense>
  );
}
