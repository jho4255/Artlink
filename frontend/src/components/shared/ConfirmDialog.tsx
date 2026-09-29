/**
 * ConfirmDialog - 확인/취소 모달 컴포넌트
 *
 * 기능:
 *  - Portal 기반 렌더링
 *  - Framer Motion scale+fade 애니메이션
 *  - variant: default(일반) / danger(삭제/위험)
 *
 * @see Phase 4 - 폼 UX 개선
 */
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  /**
   * 누르면 **무엇이 바뀌는지** 한 줄씩 (2026-09-29). 운영 단계 전환처럼 되돌리기 어려운 동작은
   * "정말 하시겠습니까?" 대신 결과를 적어 준다 — 처음 쓰는 사람은 무엇을 묻는지부터 모른다.
   */
  details?: string[];
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmText = '확인',
  cancelText = '취소',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // role="dialog" 의 이름 = 제목. 화면 낭독기가 "모집을 마감할까요? 대화상자" 로 읽는다(테스트도 이 이름으로 집는다)
  const titleId = useId();
  // 확인 버튼 더블클릭 시 중복 제출 방지 — 다이얼로그가 열릴 때마다 리셋
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  const handleConfirm = () => {
    if (busy) return; // 이미 처리 중이면 무시 (exit 애니메이션 동안 재클릭 방지)
    setBusy(true);
    onConfirm();
  };

  // ESC 키로 닫기
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  /**
   * 배경 스크롤 잠금 (ImageLightbox·InviteApplyModal 과 같은 방식).
   *
   * 없으면 모달이 떠 있는데도 뒤 페이지가 같이 움직인다. 데스크톱에선 거슬리는 정도지만
   * **모바일에서는 손가락이 모달 밖에 닿는 순간 뒤가 밀려서** 화면이 잘린 것처럼 보이고
   * 버튼을 못 누르게 된다. 마이페이지처럼 긴 화면 아래쪽에서 수락/거절할 때 특히 그렇다.
   */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const confirmBtnClass = variant === 'danger'
    ? 'bg-accent hover:bg-accent/90 text-white'
    : 'bg-gray-900 hover:bg-gray-800 text-white';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-white rounded-xl p-5 sm:p-6 mx-4 max-w-sm w-full max-h-[85vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={titleId} className="text-lg font-bold mb-2">{title}</h3>
            {message && <p className={`text-sm text-gray-600 whitespace-pre-wrap ${details?.length ? 'mb-3' : 'mb-6'}`}>{message}</p>}
            {details && details.length > 0 && (
              <ul className="mb-6 space-y-2 text-sm leading-relaxed text-gray-600">
                {details.map((d) => (
                  <li key={d} className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancel}
                className="px-4 min-h-[44px] text-sm text-gray-500 hover:text-gray-700 rounded-lg"
              >
                {cancelText}
              </button>
              <button
                onClick={handleConfirm}
                disabled={busy}
                className={`px-4 min-h-[44px] text-sm rounded-lg disabled:opacity-50 ${confirmBtnClass}`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
