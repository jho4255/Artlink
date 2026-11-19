import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Bell, BellOff, Copy, EyeOff, Eye, Flag, Home, Megaphone, Users } from 'lucide-react';
import { displayName } from '@/lib/utils';
import { chatRoleTag } from '@/lib/chatView';
import { CHAT_REPORT_REASONS, type ChatMessage, type ChatReportReason, type ChatRoomMeta } from '@/lib/chatTypes';
import ChatSheet, { SheetItem } from './ChatSheet';
import { PersonAvatar } from './ChatAvatar';

/**
 * 방 메뉴(목업 ④) — 1:1: 홈페이지 보기 · 알림 · 숨기기 · 신고 · 차단 / 단톡: 공모 보기 · 참여자 · 알림 · 숨기기.
 * 단톡에는 방 신고가 없다 — 누구를 신고하는지가 메시지로 정해진다(말풍선 길게 누르기).
 */
export function RoomMenuSheet({ meta, myTitle, onClose, onToggleMute, onToggleHidden, onReport, onBlock, onUnblock, onMembers, onNavigate }: {
  meta: ChatRoomMeta;
  myTitle: string;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleHidden: () => void;
  onReport: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onMembers: () => void;
  onNavigate: (to: string) => void;
}) {
  const group = meta.kind === 'GROUP';
  const sub = group ? `공모 단체 대화 · 참여자 ${meta.participants.length}` : [chatRoleTag(meta.counterpart?.role), '1:1 대화'].filter(Boolean).join(' · ');
  return (
    <ChatSheet title="대화방 메뉴" onClose={onClose} testId="room-menu">
      <div className="px-5 pb-2 pt-0">
        <p className="truncate text-base font-bold text-gray-900">{myTitle}</p>
        <p className="text-xs text-gray-600">{sub}</p>
      </div>
      <div className="py-1">
        {!group && meta.counterpart?.homepage && (
          <SheetItem icon={<Home size={20} />} onClick={() => onNavigate(meta.counterpart!.homepage!)}>홈페이지 보기</SheetItem>
        )}
        {group && meta.exhibition && (
          <SheetItem icon={<Megaphone size={20} />} onClick={() => onNavigate(`/exhibitions/${meta.exhibition!.id}`)}>공모 보기</SheetItem>
        )}
        {group && <SheetItem icon={<Users size={20} />} onClick={onMembers}>참여자 {meta.participants.length}</SheetItem>}
        <SheetItem icon={meta.muted ? <Bell size={20} /> : <BellOff size={20} />} onClick={onToggleMute}>
          {meta.muted ? '알림 켜기' : '알림 끄기'}
        </SheetItem>
        <SheetItem icon={meta.hidden ? <Eye size={20} /> : <EyeOff size={20} />} onClick={onToggleHidden}>
          {meta.hidden ? '목록에 다시 보이기' : '목록에서 숨기기'}
        </SheetItem>
      </div>
      {!group && meta.counterpart && !meta.counterpart.deleted && (
        <div className="border-t border-gray-200 py-1">
          <SheetItem icon={<Flag size={20} />} onClick={onReport}>신고하기</SheetItem>
          {meta.blockReason === 'blocked'
            ? <SheetItem icon={<Ban size={20} />} onClick={onUnblock}>차단 풀기</SheetItem>
            : <SheetItem icon={<Ban size={20} />} onClick={onBlock} danger>차단하기</SheetItem>}
        </div>
      )}
    </ChatSheet>
  );
}

/** 말풍선 메뉴 — 복사 · (남의 말) 신고 */
export function MessageMenuSheet({ message, mine, onClose, onCopy, onReport }: {
  message: ChatMessage; mine: boolean; onClose: () => void; onCopy: () => void; onReport: () => void;
}) {
  return (
    <ChatSheet title="메시지 메뉴" hideTitle onClose={onClose} testId="message-menu">
      {message.content && <p className="mx-5 mb-2 line-clamp-2 text-sm text-gray-600 [overflow-wrap:anywhere]">{message.content}</p>}
      <div className="py-1">
        {message.content && <SheetItem icon={<Copy size={20} />} onClick={onCopy}>복사</SheetItem>}
        {!mine && <SheetItem icon={<Flag size={20} />} onClick={onReport}>신고하기</SheetItem>}
      </div>
    </ChatSheet>
  );
}

/**
 * 신고 창 — 사유 하나 + 자세한 내용(선택). 무엇이 운영자에게 가는지 한 줄로 알린다(서버가 그 메시지와 앞뒤 몇 줄을 사본으로 남긴다).
 */
export function ReportSheet({ targetName, messageText, onClose, onSubmit, busy }: {
  targetName: string;
  messageText?: string | null;
  onClose: () => void;
  onSubmit: (reason: ChatReportReason, detail: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [detail, setDetail] = useState('');
  return (
    <ChatSheet title="신고하기" onClose={onClose} testId="report-sheet">
      <form
        className="px-5 pb-3"
        onSubmit={(e) => { e.preventDefault(); if (reason && !busy) onSubmit(reason, detail.trim()); }}
      >
        <p className="text-sm text-gray-700">
          {messageText ? <>이 메시지를 신고해요: <span className="text-gray-900">“{messageText.length > 40 ? `${messageText.slice(0, 40)}…` : messageText}”</span></> : <>{targetName} 님을 신고해요.</>}
        </p>
        <fieldset className="mt-3">
          <legend className="sr-only">신고 사유</legend>
          {CHAT_REPORT_REASONS.map(([value, label]) => (
            <label key={value} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px] text-gray-900">
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="h-5 w-5 accent-gray-900" />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="mt-2 block">
          <span className="text-sm text-gray-700">자세한 내용 (선택)</span>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, 1000))} rows={3} className="mt-1 block w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-[16px] focus:border-gray-900 focus:outline-none" />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-gray-600">신고하면 이 메시지와 앞뒤 대화 일부가 운영자에게 전달돼요.</p>
        <button type="submit" disabled={!reason || busy} className="mt-3 h-12 w-full rounded-lg bg-gray-900 text-sm font-semibold text-white disabled:bg-gray-300">
          {busy ? '보내는 중…' : '신고하기'}
        </button>
      </form>
    </ChatSheet>
  );
}

/** 단톡 참여자 — 주최(운영자)·작가 구분, 작가는 홈페이지로 */
export function MembersSheet({ meta, myId, onClose }: { meta: ChatRoomMeta; myId: number; onClose: () => void }) {
  const people = [...meta.participants].sort((a, b) => {
    const ao = meta.operatorIds.includes(a.id) ? 0 : 1;
    const bo = meta.operatorIds.includes(b.id) ? 0 : 1;
    return ao - bo || displayName(a).localeCompare(displayName(b), 'ko');
  });
  return (
    <ChatSheet title={`참여자 ${people.length}`} onClose={onClose} testId="members-sheet">
      <ul className="pb-2">
        {people.map((p) => {
          const op = meta.operatorIds.includes(p.id);
          const row = (
            <>
              <PersonAvatar person={p} size={36} operator={op} />
              <span className="min-w-0 flex-1 truncate text-[15px] text-gray-900">{displayName(p)}{p.id === myId && <span className="ml-1 text-xs text-gray-600">나</span>}</span>
              <span className={`shrink-0 text-xs ${op ? 'font-medium text-accent' : 'text-gray-600'}`}>{op ? '주최' : chatRoleTag(p.role)}</span>
            </>
          );
          return (
            <li key={p.id}>
              {p.role === 'ARTIST' && !p.deleted
                ? <Link to={`/portfolio/${p.id}`} onClick={onClose} className="flex min-h-[52px] items-center gap-3 px-5 hover:bg-gray-50">{row}</Link>
                : <div className="flex min-h-[52px] items-center gap-3 px-5">{row}</div>}
            </li>
          );
        })}
      </ul>
    </ChatSheet>
  );
}
