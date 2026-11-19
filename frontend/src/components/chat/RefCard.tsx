import { Link } from 'react-router-dom';
import Thumb from '@/components/shared/Thumb';
import { CHAT_REF_LABEL } from '@/lib/chatView';
import type { ChatRef } from '@/lib/chatTypes';

/**
 * 맥락 카드 — "무엇에 대한 말인가"(작품·공모·전시·갤러리 문의, 2026-11-19).
 * 카드 내용(제목·부제·그림·링크)은 **서버가 만든다** — 여기서는 그리기만 한다.
 *  · `pinned` — 방 머리 아래 고정(가장 최근 카드)
 *  · 그 밖 — 말풍선 안
 * 그림은 자르지 않는다(contain, 규칙 18). 링크는 우리 사이트 경로뿐이라 같은 탭으로 간다.
 */
export default function RefCard({ refItem, pinned = false }: { refItem: ChatRef; pinned?: boolean }) {
  const action = refItem.type === 'WORK' ? '작품 보기' : refItem.type === 'EXHIBITION' ? '공모 보기' : refItem.type === 'SHOW' ? '전시 보기' : '갤러리 보기';
  if (pinned) {
    return (
      <Link
        to={refItem.link}
        data-testid="chat-context"
        className="flex min-w-0 items-center gap-3 border-b border-gray-200 px-4 py-2.5 hover:bg-gray-50 lg:px-6"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden bg-gray-100">
          {refItem.image && <Thumb src={refItem.image} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] text-gray-600">{CHAT_REF_LABEL[refItem.type]}</span>
          <span className="truncate text-sm font-medium text-gray-900">{refItem.title}</span>
          {refItem.sub && <span className="truncate text-xs text-gray-600">{refItem.sub}</span>}
        </span>
        <span className="shrink-0 text-[13px] text-gray-900 underline underline-offset-4">{action}</span>
      </Link>
    );
  }
  return (
    <Link
      to={refItem.link}
      className="flex w-[240px] max-w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2 text-left hover:bg-gray-50"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden bg-gray-100">
        {refItem.image && <Thumb src={refItem.image} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] text-gray-600">{CHAT_REF_LABEL[refItem.type]}</span>
        <span className="truncate text-[13px] font-medium text-gray-900">{refItem.title}</span>
        {refItem.sub && <span className="truncate text-[11px] text-gray-600">{refItem.sub}</span>}
      </span>
    </Link>
  );
}
