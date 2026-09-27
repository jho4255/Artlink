import { useEffect, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, Heading2, Heading3, List, ListOrdered, Quote, Link2, Minus, Undo2, Redo2,
} from 'lucide-react';
import { richTextLength, toEditorHtml } from '@/lib/richText';

/**
 * 서식 있는 글 편집기 (2026-09-28, 사용자 요청 "소개 적을 때 기본적인 워드 형태는 갖춰야") — TipTap.
 *
 * **쓰는 모양 = 보이는 모양** — 편집 영역이 공개 화면과 같은 `.rich-text` 클래스를 쓴다(index.css).
 * 도구는 워드의 가장 기본만: 제목·소제목 · 굵게·기울임·밑줄 · 글머리·번호 목록 · 인용 · 링크 · 구분선 · 되돌리기.
 * 글꼴·색·크기·이미지는 **일부러 없다** — 갤러리 페이지 디자인을 깨고(워드에서 붙여 넣은 서식도 여기서 떨어진다),
 * 이미지는 외부 주소 주입 통로가 된다. 허용 목록은 서버·화면 `lib/richText.ts` 와 같다.
 *
 * `React.lazy` 로만 불러올 것 — TipTap 은 방문자에게 필요 없다(주인이 [수정]을 누를 때만 받는다).
 * 옛 평범한 글은 `toEditorHtml` 이 문단으로 바꿔 넣는다(줄바꿈 유지).
 */
export default function RichTextEditor({ value, onChange, placeholder, maxLength, minHeight = 160 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 보이는 글자 수 한도 — 넘으면 숫자를 빨갛게(저장은 서버가 400 으로 막는다) */
  maxLength?: number;
  minHeight?: number;
}) {
  // 처음 글자 수는 받은 값에서 센다 — onCreate 에서 세면 'mount 전 setState' 경고가 나고,
  // 마운트 직후 effect 에서 editor.getText() 를 부르면 스키마가 아직 없어 페이지가 통째로 죽는다(둘 다 실제로 났다)
  const [count, setCount] = useState(() => richTextLength(value));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'], HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' } },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: toEditorHtml(value),
    editorProps: {
      attributes: {
        class: 'rich-text min-w-0 px-4 py-3 text-[15px] leading-[1.9] text-gray-800 break-keep [overflow-wrap:anywhere] focus:outline-none',
        style: `min-height:${minHeight}px`,
        'aria-label': placeholder ?? '본문',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: e }) => {
      setCount(e.getText().trim().length);
      onChange(e.isEmpty ? '' : e.getHTML());
    },
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-gray-400">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      {maxLength && (
        <p className={`border-t border-gray-100 px-4 py-1.5 text-right text-[11px] tabular-nums ${count > maxLength ? 'text-accent' : 'text-gray-400'}`}>
          {count.toLocaleString()} / {maxLength.toLocaleString()}
        </p>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // 선택이 바뀔 때마다 버튼의 켜짐 상태를 다시 그린다
  const [, force] = useState(0);
  useEffect(() => {
    const re = () => force((n) => n + 1);
    editor.on('selectionUpdate', re);
    editor.on('transaction', re);
    return () => { editor.off('selectionUpdate', re); editor.off('transaction', re); };
  }, [editor]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, active = false, disabled = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}   // 누를 때 편집 영역의 선택이 풀리지 않게
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
    >
      {icon}
    </button>
  );
  const sep = <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden />;
  const chain = () => editor.chain().focus();

  const openLink = () => {
    setHref((editor.getAttributes('link').href as string | undefined) ?? '');
    setLinkOpen((o) => !o);
  };
  const applyLink = () => {
    const url = href.trim();
    if (!url) { chain().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); return; }
    // 주소만 쳐도 되게 — 스킴이 없으면 https:// 를 붙인다(mailto 는 그대로)
    const full = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: full } }] }).run();
    } else {
      chain().extendMarkRange('link').setLink({ href: full }).run();
    }
    setLinkOpen(false);
  };

  return (
    <div className="border-b border-gray-100">
      <div role="toolbar" aria-label="서식" className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
        {btn('제목', <Heading2 size={16} />, () => chain().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {btn('소제목', <Heading3 size={16} />, () => chain().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
        {sep}
        {btn('굵게', <Bold size={16} />, () => chain().toggleBold().run(), editor.isActive('bold'))}
        {btn('기울임', <Italic size={16} />, () => chain().toggleItalic().run(), editor.isActive('italic'))}
        {btn('밑줄', <UnderlineIcon size={16} />, () => chain().toggleUnderline().run(), editor.isActive('underline'))}
        {sep}
        {btn('글머리 목록', <List size={16} />, () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('번호 목록', <ListOrdered size={16} />, () => chain().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('인용', <Quote size={16} />, () => chain().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {btn('링크', <Link2 size={16} />, openLink, editor.isActive('link') || linkOpen)}
        {btn('구분선', <Minus size={16} />, () => chain().setHorizontalRule().run())}
        {sep}
        {btn('실행 취소', <Undo2 size={16} />, () => chain().undo().run(), false, !editor.can().undo())}
        {btn('다시 실행', <Redo2 size={16} />, () => chain().redo().run(), false, !editor.can().redo())}
      </div>
      {linkOpen && (
        <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
          <input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }}
            placeholder="https://… (비우고 적용하면 링크 해제)"
            aria-label="링크 주소"
            className="min-w-0 flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <button type="button" onClick={applyLink} className="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white">적용</button>
        </div>
      )}
    </div>
  );
}
