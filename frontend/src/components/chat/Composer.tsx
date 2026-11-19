import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Film, Image as ImageIcon, Plus } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CHAT_COUNT_FROM, CHAT_MAX_LEN } from '@/lib/chatView';
import { readChatDraft, writeChatDraft } from '@/lib/chatCache';
import type { AttachmentType } from '@/lib/chatTypes';

/**
 * 입력 줄 (2026-11-19 개편 — 목업 ②).
 *  · **여러 줄** — 예전엔 한 줄 `<input>` 이라 줄바꿈을 칠 수 없었다. 1~5줄(넓은 화면 2~8줄)로 늘어난다
 *  · Enter: 휴대폰(손가락)은 줄바꿈, 마우스 화면은 보내기 · Shift+Enter 줄바꿈 · ⚠️ 한글 조합 중 Enter 는 건드리지 않는다(isComposing)
 *  · 2,000자 — 1,800 부터 글자 수를 보여 주고, 넘으면 [보내기]를 잠근다(예전엔 말없이 잘랐다)
 *  · 방마다 쓰던 글을 이 탭에 둔다 — 방을 옮겼다 와도 남는다(로그아웃하면 지운다)
 *  · [+] 사진(여러 장)·동영상·파일 — 고르는 즉시 보낸다(쓰던 글은 그대로 둔다). 넓은 화면은 끌어다 놓기·붙여 넣기도
 *  · 글자 16px — iOS 가 입력칸을 누를 때 화면을 확대하지 않게
 */
export default function Composer({ chatId, onSend, onFiles, disabled = false }: {
  chatId: number;
  onSend: (text: string) => void;
  onFiles: (files: File[], type: AttachmentType) => void;
  disabled?: boolean;
}) {
  const fine = useMediaQuery('(pointer: fine)');
  const [text, setText] = useState(() => readChatDraft(chatId));
  const [menu, setMenu] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const kindRef = useRef<AttachmentType>('IMAGE');

  useEffect(() => { writeChatDraft(chatId, text); }, [chatId, text]);

  // 글 높이에 맞춰 늘인다(최대 줄 수까지)
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = (fine ? 8 : 5) * 22 + 22;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [text, fine]);

  const tooLong = text.length > CHAT_MAX_LEN;
  const canSend = !disabled && !!text.trim() && !tooLong;

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
    area.current?.focus();
  };

  const pick = (kind: AttachmentType) => {
    kindRef.current = kind;
    setMenu(false);
    const input = fileInput.current;
    if (!input) return;
    input.accept = kind === 'IMAGE' ? 'image/*' : kind === 'VIDEO' ? 'video/*' : '.pdf,.doc,.docx,.hwp,.hwpx,.zip';
    input.multiple = kind === 'IMAGE';
    input.value = '';
    input.click();
  };

  return (
    <div className="relative shrink-0 border-t border-gray-200 bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:px-4 lg:pb-4">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        data-testid="chat-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files, kindRef.current);
        }}
      />
      {menu && (
        <div className="absolute bottom-full left-2 z-10 mb-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg" role="menu" aria-label="첨부">
          {([
            ['IMAGE', '사진', <ImageIcon size={16} key="i" aria-hidden />],
            ['VIDEO', '동영상', <Film size={16} key="v" aria-hidden />],
            ['FILE', '파일', <FileText size={16} key="f" aria-hidden />],
          ] as const).map(([kind, label, icon]) => (
            <button key={kind} type="button" role="menuitem" onClick={() => pick(kind)} className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-sm text-gray-900 hover:bg-gray-50">
              {icon} {label}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-1.5"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}   // 글 칸의 포커스를 뺏지 않는다 — 휴대폰 자판이 내려가지 않게(규칙 81 keepFocus)
          onClick={() => setMenu((v) => !v)}
          disabled={disabled}
          aria-label="사진·동영상·파일 첨부"
          aria-expanded={menu}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-900 hover:bg-gray-100 disabled:opacity-40"
        >
          <Plus size={22} aria-hidden />
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">메시지</span>
          <textarea
            ref={area}
            rows={fine ? 2 : 1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setMenu(false)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (fine && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
              if (files.length) { e.preventDefault(); onFiles(files, 'IMAGE'); }
            }}
            placeholder="메시지를 입력하세요"
            aria-describedby={text.length >= CHAT_COUNT_FROM ? `chat-count-${chatId}` : undefined}
            className="block max-h-[200px] min-h-[44px] w-full resize-none rounded-[10px] border border-gray-300 bg-white px-3 py-[10px] text-[16px] leading-[22px] text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none disabled:bg-gray-50"
          />
        </label>
        <button
          type="submit"
          disabled={!canSend}
          aria-label="보내기"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-gray-900 text-white disabled:bg-gray-300 lg:w-auto lg:px-4"
        >
          <ArrowUp size={20} aria-hidden className="lg:hidden" />
          <span className="hidden text-sm font-medium lg:inline">보내기</span>
        </button>
      </form>
      {text.length >= CHAT_COUNT_FROM && (
        <p id={`chat-count-${chatId}`} className={`mt-1 pr-14 text-right text-xs ${tooLong ? 'text-accent' : 'text-gray-600'}`}>
          {text.length.toLocaleString()} / {CHAT_MAX_LEN.toLocaleString()}
        </p>
      )}
    </div>
  );
}
