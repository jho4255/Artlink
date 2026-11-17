import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';

/**
 * 도구 막대의 켜짐 상태 — `useEditorState` 선택자로만 읽는다(트랜잭션마다 막대 전체를 다시 그리지 않게).
 * 컴포넌트 파일(Toolbar.tsx)과 나눠 둔다 — 한 파일에 컴포넌트와 훅을 같이 내보내면 빠른 새로고침이 깨진다.
 */
export function useFormatState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      pull: e.isActive('blockquote', { variant: 'pull' }),
      center: e.isActive({ textAlign: 'center' }),
      callout: e.isActive('callout'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
}
