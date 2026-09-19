import { useState, type ReactNode } from 'react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

/**
 * 확인창을 품은 삭제 버튼 — 되돌릴 수 없는 삭제에 확인 없이 `mutate` 를 바로 거는 곳이 여럿이었다(2026-09-19 감사).
 *
 * 관리자 히어로·혜택·이달의 갤러리·광고 삭제(파일까지 지운다), 방명록·소식·소식 댓글 삭제가 아이콘 한 번에 나갔다.
 * 아이콘 히트박스가 44px 이라 오터치도 흔하다. 섹션마다 state+ConfirmDialog 를 두는 대신 버튼 하나로 감싼다.
 */
export default function ConfirmDeleteButton({
  onConfirm, title, message, confirmText = '삭제', className, children, disabled, 'aria-label': ariaLabel = '삭제',
}: {
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} disabled={disabled} aria-label={ariaLabel} className={className}>
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        message={message}
        confirmText={confirmText}
        variant="danger"
        onConfirm={() => { setOpen(false); onConfirm(); }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
