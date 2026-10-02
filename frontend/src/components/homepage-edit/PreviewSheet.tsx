import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * 좁은 화면의 미리보기 — 전체 화면 시트 (2026-10-02)
 *
 * 넓은 화면에서는 미리보기가 입력란 옆에 붙어 따라오는데, 휴대폰에서는 입력란 **전체 뒤**(실측 3,289px 아래)에 있어
 * 보면서 쓸 수가 없었다. 저장 바의 [미리보기] 로 언제든 띄운다 — 저장하기 전 내용이 그대로 보인다.
 * 열려 있는 동안 뒤 화면은 스크롤되지 않는다(ConfirmDialog 와 같은 방식).
 */
export default function PreviewSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="홈페이지 미리보기" data-testid="preview-sheet" className="fixed inset-0 z-[60] flex flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-5 py-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-gray-950">미리보기</p>
          <p className="text-xs text-gray-500">저장하기 전 내용이 그대로 보여요.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="미리보기 닫기" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-gray-500 hover:text-gray-900">
          <X size={20} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{children}</div>
    </div>,
    document.body,
  );
}
