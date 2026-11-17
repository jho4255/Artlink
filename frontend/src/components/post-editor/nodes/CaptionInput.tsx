import { useEffect, useRef, useState } from 'react';
import { POST_DOC_LIMITS } from '@/lib/postDoc';

/**
 * 사진·모음·영상 아래 설명 칸 — 노드 속성(caption)을 고친다.
 * - 치는 동안은 칸 안에만 두고, 손을 멈추면(0.6초)·칸을 떠나면·Enter 면 문서에 쓴다 — 글자마다 문서를 바꾸면 되돌리기 기록이 글자 단위로 쌓인다.
 * - 한글 조합 중 Enter 는 건드리지 않는다(조합이 끝나며 들어오는 Enter 가 다음 칸으로 넘기면 마지막 글자가 사라진다).
 * - Enter → 다음 줄(사진 뒤 문단)로, Esc → 칸을 떠나 사진을 고른 상태로.
 */
export default function CaptionInput({ value, onCommit, onEnter, onEscape, visible, placeholder = '사진 설명을 적어 주세요 (선택)', autoFocusToken }: {
  value: string;
  onCommit: (v: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  visible: boolean;
  placeholder?: string;
  /** 바뀌면 칸에 커서를 둔다([설명] 단추) */
  autoFocusToken?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(value);

  // 밖에서 바뀌면(되돌리기 등) 따라간다 — 치는 중이면 건드리지 않는다
  useEffect(() => {
    if (!focused && value !== last.current) {
      last.current = value;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(value);
    }
  }, [value, focused]);

  useEffect(() => {
    if (autoFocusToken) ref.current?.focus();
  }, [autoFocusToken]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (v: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const clean = v.replace(/\s+/g, ' ').trim().slice(0, POST_DOC_LIMITS.captionChars);
    if (clean !== last.current) { last.current = clean; onCommit(clean); }
  };

  if (!visible && !focused && !draft) return null;
  return (
    <figcaption className="post-caption-edit" data-nv-control>
      <input
        ref={ref}
        type="text"
        value={draft}
        maxLength={POST_DOC_LIMITS.captionChars}
        placeholder={placeholder}
        aria-label="사진 설명"
        enterKeyHint="next"
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), 600);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(draft); onEnter?.(); }
          else if (e.key === 'Escape') { e.preventDefault(); commit(draft); onEscape?.(); }
        }}
        className="w-full border-0 border-b border-transparent bg-transparent px-1 py-1.5 text-center text-[13px] leading-relaxed text-gray-600 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
      />
    </figcaption>
  );
}
