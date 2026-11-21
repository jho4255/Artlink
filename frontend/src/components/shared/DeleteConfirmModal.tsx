import { useState } from 'react';

/**
 * 삭제 이중 확인 — '삭제' 를 입력해야 진행(갤러리·공모·전시 공용). 2026-11-20 마이페이지에서 꺼냈다(공모 한 건 화면도 쓴다).
 */
export default function DeleteConfirmModal({ open, name, description, onConfirm, onCancel, pending }: { open: boolean; name: string; description: string; onConfirm: () => void; onCancel: () => void; pending?: boolean }) {
  const [text, setText] = useState('');
  // 열릴 때마다 빈 칸에서 시작 — 렌더 중 상태 맞추기(effect 안 setState 금지)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) setText(''); }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">삭제 확인</h3>
        <p className="text-sm text-gray-600 mt-2"><b>{name}</b> {description}</p>
        <p className="text-sm text-gray-700 mt-3">계속하려면 아래에 <b className="text-accent">삭제</b> 를 입력하세요.</p>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="삭제"
          autoFocus
          className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500">취소</button>
          <button
            onClick={onConfirm}
            disabled={text.trim() !== '삭제' || pending}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >삭제</button>
        </div>
      </div>
    </div>
  );
}
