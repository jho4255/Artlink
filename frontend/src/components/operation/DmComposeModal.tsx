import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * 여러 작가에게 한 번에 보내는 안내 메시지(작가별 1:1 대화로 들어간다) — 출품 자료 제출 안내 · 정산 확인 재안내 (2026-09-29).
 *
 * 예전엔 운영 화면 오른쪽 '운영 도우미' 상자에 숨어 있었다(세 항목이 대부분 비활성이라 있는 줄 몰랐다).
 * 지금은 필요한 구역의 머리 줄에서 연다 — 출품 자료 구역(미제출 작가가 있을 때) · 정산 구역(미응답 작가가 있을 때).
 * 서버가 작가별 갠톡으로 넣는다(`lib/chat.ts sendDirectNotice`) — 단톡이면 누가 안 냈는지가 전원에게 보인다.
 */
export default function DmComposeModal({ open, title, description, recipients, defaultSubject, defaultContent, sending, sendLabel, onSend, onClose }: {
  open: boolean;
  title: string;
  description: string;
  /** 받는 사람과 그 사람에게 남은 일(예: '작가노트') */
  recipients: { id: number; name: string; note?: string }[];
  defaultSubject: string;
  defaultContent: string;
  sending: boolean;
  sendLabel: (n: number) => string;
  onSend: (v: { subject: string; content: string }) => void;
  onClose: () => void;
}) {
  // ⚠️ 부르는 쪽은 열 때만 그린다(`{open && <DmComposeModal …/>}`) — 그래야 열 때마다 기본 문구로 시작한다.
  //    지난번에 고치다 만 문구가 남아 있으면 엉뚱한 사람에게 간다.
  const [subject, setSubject] = useState(defaultSubject);
  const [content, setContent] = useState(defaultContent);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-950">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 grid h-10 w-10 shrink-0 place-items-center text-gray-400 hover:text-gray-900"><X size={18} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="text-xs font-medium text-gray-500">받는 사람 {recipients.length}명</p>
            {recipients.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">보낼 사람이 없어요.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {recipients.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium text-gray-900">{r.name}</span>
                    {r.note && <span className="shrink-0 text-xs text-gray-500">{r.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">제목</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">내용</span>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={7} className="mt-1 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-gray-400 focus:outline-none" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-4 text-sm text-gray-500 hover:text-gray-900">취소</button>
          <button
            type="button"
            onClick={() => onSend({ subject: subject.trim(), content: content.trim() })}
            disabled={sending || recipients.length === 0 || !subject.trim() || !content.trim()}
            className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {sending ? '보내는 중…' : sendLabel(recipients.length)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
