import { memo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, Loader2, MoreHorizontal } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';
import { displayName } from '@/lib/utils';
import { bubbleTime, linkParts } from '@/lib/chatView';
import { resolveSiteLink } from '@/lib/siteLink';
import type { ChatMessage, PendingMessage } from '@/lib/chatTypes';
import { PersonAvatar } from './ChatAvatar';
import RefCard from './RefCard';

/**
 * 말풍선 한 줄 (2026-11-19 개편 — 목업 ②③).
 *  · 남의 말: 묶음 첫 줄에 얼굴(30) · 단톡이면 이름(+ 운영자는 '주최')
 *  · 시각은 묶음 **마지막** 말풍선 옆(카카오톡처럼, 늘 '오후 8:46' — 날짜는 구분 줄이 말한다) · 내 말엔 '읽음'(1:1)·안 읽은 사람 수(단톡)
 *  · 주소는 눌린다(우리 사이트면 같은 탭) — 글을 HTML 로 넣지 않고 토막 내 그린다
 *  · 길게 누르기(휴대폰)·오른쪽 클릭·[⋯](마우스) → 메시지 메뉴(복사·신고)
 * 사진·동영상 칸은 **크기를 먼저 잡는다** — 늦게 뜨며 대화를 밀지 않게. 사진은 자르지 않는다(contain, 규칙 18).
 */
const BUBBLE = 'rounded-[14px] px-3 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]';

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  const mb = n / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

function MessageText({ text, mine }: { text: string; mine: boolean }) {
  return (
    <>
      {linkParts(text).map((part, i) => {
        if (part.kind === 'text') return <span key={i}>{part.value}</span>;
        const link = resolveSiteLink(part.value);
        const cls = `underline underline-offset-2 ${mine ? 'text-white' : 'text-gray-900'}`;
        if (link?.kind === 'route') return <Link key={i} to={link.path} className={cls}>{part.value}</Link>;
        return <a key={i} href={link?.kind === 'external' ? link.url : part.value} target="_blank" rel="noopener noreferrer" className={cls}>{part.value}</a>;
      })}
    </>
  );
}

function Attachment({ m, onOpenImage, preview }: { m: Pick<ChatMessage, 'attachmentUrl' | 'attachmentType' | 'attachmentName' | 'attachmentSize'>; onOpenImage?: (url: string) => void; preview?: string }) {
  const url = preview || m.attachmentUrl || '';
  if (m.attachmentType === 'IMAGE') {
    const img = preview
      ? <img src={preview} alt="" className="max-h-full max-w-full object-contain" />
      : <Thumb src={url} size="grid" alt="보낸 사진" loading="lazy" className="max-h-full max-w-full object-contain" />;
    return onOpenImage && !preview ? (
      <button type="button" onClick={() => onOpenImage(url)} aria-label="사진 크게 보기" className="grid h-[200px] w-[200px] place-items-center overflow-hidden rounded-xl bg-gray-100 hover:opacity-90">
        {img}
      </button>
    ) : (
      <span className="grid h-[200px] w-[200px] place-items-center overflow-hidden rounded-xl bg-gray-100">{img}</span>
    );
  }
  if (m.attachmentType === 'VIDEO') {
    if (preview) return <span className="grid h-[180px] w-[240px] place-items-center rounded-xl bg-gray-900 text-xs text-white/80">동영상</span>;
    return <video src={url} controls preload="metadata" className="h-[180px] w-[240px] rounded-xl bg-black object-contain" />;
  }
  const name = m.attachmentName || '첨부파일';
  const size = formatBytes(m.attachmentSize);
  const body = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-600"><FileText size={18} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">{name}</span>
        <span className="block text-xs text-gray-600">{size ? `${size} · ` : ''}{preview ? '올리는 중' : '받기'}</span>
      </span>
      {!preview && <Download size={16} aria-hidden className="ml-auto shrink-0 text-gray-500" />}
    </>
  );
  const cls = 'flex w-[230px] max-w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5';
  return preview ? <span className={cls}>{body}</span> : <a href={url} target="_blank" rel="noreferrer" download={name} className={`${cls} hover:bg-gray-50`}>{body}</a>;
}

/** 길게 누르기 — 0.5초, 손가락이 움직이면 취소. 메뉴가 열리면 뒤이어 오는 click 을 버린다 */
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  return {
    onTouchStart: () => {
      fired.current = false;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { fired.current = true; onLong(); }, 500);
    },
    onTouchMove: () => clearTimeout(timer.current),
    onTouchEnd: (e: React.TouchEvent) => { clearTimeout(timer.current); if (fired.current) e.preventDefault(); },
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!fired.current) onLong(); fired.current = false; },
  };
}

export interface BubbleProps {
  m: ChatMessage;
  mine: boolean;
  kind: 'DIRECT' | 'GROUP';
  first: boolean;
  last: boolean;
  operator: boolean;
  onOpenImage: (url: string) => void;
  onMenu: (m: ChatMessage) => void;
}

export const MessageBubble = memo(function MessageBubble({ m, mine, kind, first, last, operator, onOpenImage, onMenu }: BubbleProps) {
  const press = useLongPress(() => onMenu(m));
  const showName = kind === 'GROUP' && !mine && first;
  const meta = last ? (
    <span className="flex shrink-0 flex-col items-end text-[11px] leading-tight text-gray-600" data-testid="bubble-meta">
      {mine && kind === 'DIRECT' && m.read && <span>읽음</span>}
      {mine && kind === 'GROUP' && (m.unreadBy ?? 0) > 0 && <b className="font-bold text-accent" aria-label={`아직 안 읽은 사람 ${m.unreadBy}명`}>{m.unreadBy}</b>}
      <span>{bubbleTime(m.createdAt)}</span>
    </span>
  ) : null;

  return (
    <div
      data-mid={m.id}
      className={`group flex gap-2 ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-3' : 'mt-1'}`}
    >
      {!mine && (first ? <PersonAvatar person={m.sender} size={30} operator={operator} /> : <span aria-hidden className="w-[30px] shrink-0" />)}
      <div className={`flex min-w-0 max-w-[76%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
        {showName && (
          <span className="text-xs text-gray-700" data-testid="bubble-name">
            {displayName(m.sender)}{operator && <span className="ml-1 font-medium text-accent">주최</span>}
          </span>
        )}
        <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
          <div
            className={`flex min-w-0 flex-col gap-1 ${mine ? 'items-end' : 'items-start'} [-webkit-touch-callout:none] pointer-coarse:select-none`}
            {...press}
          >
            {m.ref && <RefCard refItem={m.ref} />}
            {m.attachmentUrl && m.attachmentType && <Attachment m={m} onOpenImage={onOpenImage} />}
            {m.content && (
              <p className={`m-0 ${BUBBLE} ${mine ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`} data-testid="bubble-text">
                <MessageText text={m.content} mine={mine} />
              </p>
            )}
          </div>
          {meta}
          <button
            type="button"
            onClick={() => onMenu(m)}
            aria-label="메시지 메뉴"
            className="hidden h-8 w-8 shrink-0 place-items-center self-center rounded-full text-gray-500 opacity-0 hover:bg-gray-100 focus:opacity-100 group-hover:opacity-100 pointer-fine:grid"
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
});

/** 보내는 중·못 보낸 말 — 늘 맨 아래, 내 쪽 */
export function PendingBubble({ p, onRetry, onDiscard }: { p: PendingMessage; onRetry: (id: string) => void; onDiscard: (id: string) => void }) {
  const failed = p.status === 'failed';
  return (
    <div className="mt-1 flex justify-end gap-2" data-pending={p.status}>
      <div className="flex min-w-0 max-w-[76%] flex-col items-end gap-1">
        <div className="flex items-end gap-1.5">
          {failed ? (
            <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
              <button type="button" onClick={() => onRetry(p.tempId)} className="min-h-[32px] text-accent underline underline-offset-2">다시 보내기</button>
              <button type="button" onClick={() => onDiscard(p.tempId)} className="min-h-[28px] text-gray-600 underline underline-offset-2">지우기</button>
            </span>
          ) : (
            <Loader2 size={14} aria-label="보내는 중" className="mb-1 shrink-0 animate-spin text-gray-500" />
          )}
          <div className={`flex min-w-0 flex-col items-end gap-1 ${failed ? '' : 'opacity-70'}`}>
            {p.attachmentType && <Attachment m={{ attachmentType: p.attachmentType, attachmentName: p.file?.name, attachmentSize: p.file?.size }} preview={p.previewUrl || 'pending'} />}
            {p.content && (
              <p className={`m-0 ${BUBBLE} ${failed ? 'border border-gray-300 bg-white text-gray-700' : 'bg-gray-900 text-white'}`}>{p.content}</p>
            )}
          </div>
        </div>
        {failed && p.error && <span role="alert" className="text-xs text-accent">{p.error}</span>}
      </div>
    </div>
  );
}
