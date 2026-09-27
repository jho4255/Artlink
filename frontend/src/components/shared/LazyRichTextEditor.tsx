import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * 서식 있는 글 편집기를 **필요할 때만** 받는다 — TipTap(약 100KB gzip)은 방문자에게 필요 없고, 주인이 [수정]을 누를 때만 쓴다.
 * 새 배포로 청크 이름이 바뀌어 옛 청크가 404 면 한 번만 새로고침한다(App.tsx `lazyWithReload` 와 같은 가드).
 * 이때는 아직 아무것도 안 쓴 상태라(편집기가 뜨기 전) 새로고침해도 잃는 글이 없다.
 */
const Editor = lazy(() =>
  import('@/components/shared/RichTextEditor').catch((err) => {
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

export default function LazyRichTextEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<div className="animate-pulse rounded-lg border border-gray-200 bg-gray-50" style={{ height: (props.minHeight ?? 160) + 48 }} />}>
      <Editor {...props} />
    </Suspense>
  );
}
