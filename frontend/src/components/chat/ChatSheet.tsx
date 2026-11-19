import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * ArtTalk 의 창 하나 — 휴대폰은 아래에서 올라오고, 넓은 화면은 가운데(2026-11-19 개편).
 * `role="dialog" aria-modal` + Esc + 바깥 누르기 + 뒤 페이지 스크롤 잠금.
 * ⚠️ 앱 뒤로가기는 떠 있는 창에 Esc 를 보낸다(lib/native.ts, 규칙 79) — 창마다 이 껍데기를 쓰면 저절로 맞는다.
 *    예전 이웃 고르기·사진 크게 보기는 role 이 없어 뒤로가기가 창 대신 화면을 넘겼다.
 */
export default function ChatSheet({ title, onClose, children, hideTitle = false, testId }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 제목을 눈에는 감춘다(화면 낭독기는 읽는다) */
  hideTitle?: boolean;
  testId?: string;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      back?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className="relative max-h-[85svh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[max(12px,env(safe-area-inset-bottom))] text-gray-900 outline-none md:mx-4 md:max-w-sm md:rounded-2xl md:pb-3"
      >
        <div className={`flex items-center justify-between pl-5 pr-2 ${hideTitle ? 'pt-2' : 'pt-3 pb-1'}`}>
          <h2 id={titleId} className={hideTitle ? 'sr-only' : 'text-base font-bold'}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto grid h-11 w-11 place-items-center text-gray-600 hover:text-gray-900">
            <X size={20} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 창 안의 한 줄 단추 — 아이콘 + 글자, 52px */
export function SheetItem({ icon, children, onClick, danger = false }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[52px] w-full items-center gap-3.5 px-5 text-left text-[15px] hover:bg-gray-50 ${danger ? 'text-accent' : 'text-gray-900'}`}
    >
      <span aria-hidden className="grid w-5 place-items-center">{icon}</span>
      {children}
    </button>
  );
}
