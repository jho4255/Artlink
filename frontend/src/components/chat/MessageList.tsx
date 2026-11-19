import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { dividerLabel, groupFlags, showsDayDivider } from '@/lib/chatView';
import type { ChatMessage, PendingMessage } from '@/lib/chatTypes';
import { MessageBubble, PendingBubble } from './MessageBubble';

/**
 * 메시지 목록 — 스크롤을 여기서 쥔다 (2026-11-19 개편).
 *
 *  · 처음 열면 맨 아래 · 새 말이 오면 **맨 아래 근처(80px)에 있을 때만** 따라 내려간다. 위로 올려 지난 말을 읽는 중이면
 *    끌어내리지 않고 [새 메시지 N ↓] 를 띄운다(예전엔 마지막 id 가 바뀌면 무조건 내려가 읽던 자리를 잃었다)
 *  · 내가 보낸 말은 늘 내려간다
 *  · [이전 메시지]로 위를 채우면 늘어난 높이만큼 되돌려 보던 자리를 지킨다
 *  · 날짜(KST)가 바뀌는 자리에 구분 줄 — '2026년 11월 19일 목요일'
 */
export default function MessageList({
  kind, myId, messages, pending, hasMore, loadingOlder, loaded, operatorIds, emptyText,
  onLoadOlder, onOpenImage, onMenu, onRetry, onDiscard,
}: {
  kind: 'DIRECT' | 'GROUP';
  myId: number;
  messages: ChatMessage[];
  pending: PendingMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  loaded: boolean;
  operatorIds: number[];
  emptyText: string;
  onLoadOlder: () => Promise<boolean>;
  onOpenImage: (url: string) => void;
  onMenu: (m: ChatMessage) => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastSeenId = useRef(0);
  const didInit = useRef(false);
  const restoreFrom = useRef<number | null>(null);
  const [unseen, setUnseen] = useState(0);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom.current && unseen) setUnseen(0);
  };

  /** 맨 아래로 — DOM 만 움직인다(상태는 부르는 쪽이 — effect 안에서 setState 를 바로 부르지 않으려고) */
  const scrollDown = useCallback((smooth = false) => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    nearBottom.current = true;
  }, []);

  const lastMsg = messages[messages.length - 1];
  const lastKey = pending.length ? pending[pending.length - 1].tempId : lastMsg ? `m${lastMsg.id}` : '';
  const firstId = messages[0]?.id ?? 0;

  // 새 말 — 따라 내려갈지, [새 메시지 N] 을 늘릴지
  useLayoutEffect(() => {
    if (!loaded || !box.current) return;
    if (!didInit.current) {
      didInit.current = true;
      lastSeenId.current = lastMsg?.id ?? 0;
      scrollDown();
      return;
    }
    const fresh = messages.filter((m) => m.id > lastSeenId.current);
    lastSeenId.current = Math.max(lastSeenId.current, lastMsg?.id ?? 0);
    const mineNew = pending.length > 0 || fresh.some((m) => m.senderId === myId);
    const others = fresh.filter((m) => m.senderId !== myId).length;
    const follow = nearBottom.current || mineNew;
    if (follow) scrollDown();
    // 숫자는 다음 프레임에 — effect 안에서 setState 를 바로 부르면 렌더가 꼬리를 문다(react-hooks/set-state-in-effect)
    const raf = requestAnimationFrame(() => {
      if (follow) setUnseen(0);
      else if (others) setUnseen((n) => n + others);
    });
    return () => cancelAnimationFrame(raf);
  }, [lastKey, loaded]); // eslint-disable-line react-hooks/exhaustive-deps -- 마지막 줄이 바뀔 때만 판단한다(개수로 보면 [이전 메시지]에도 튄다)

  // [이전 메시지] — 위에 붙은 만큼 되돌린다
  useLayoutEffect(() => {
    const el = box.current;
    if (el && restoreFrom.current != null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    }
  }, [firstId]);

  const loadOlder = async () => {
    const el = box.current;
    if (el) restoreFrom.current = el.scrollHeight - el.scrollTop;
    const ok = await onLoadOlder();
    if (!ok) restoreFrom.current = null;
  };

  // 묶음·날짜 판정은 확정된 말과 보내는 중인 말을 이어서 본다(보내는 중인 말은 늘 내 말·맨 아래)
  const flat = [
    ...messages.map((m) => ({ senderId: m.senderId, createdAt: m.createdAt })),
    ...pending.map((p) => ({ senderId: myId, createdAt: p.createdAt })),
  ];

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={box}
        onScroll={onScroll}
        data-testid="chat-scroll"
        className="h-full overflow-y-auto overscroll-contain px-3 pb-4 pt-2 lg:px-6"
      >
        {hasMore && (
          <div className="py-2 text-center">
            <button type="button" onClick={loadOlder} disabled={loadingOlder} className="min-h-[36px] px-3 text-xs text-gray-600 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50">
              {loadingOlder ? '불러오는 중…' : '이전 메시지 더 보기'}
            </button>
          </div>
        )}
        {loaded && messages.length === 0 && pending.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-600">{emptyText}</p>
        )}
        {messages.map((m, i) => {
          const { first, last } = groupFlags(flat, i);
          return (
            <Fragment key={m.id}>
              {showsDayDivider(flat, i) && <DayDivider iso={m.createdAt} />}
              <MessageBubble
                m={m}
                mine={m.senderId === myId}
                kind={kind}
                first={first || showsDayDivider(flat, i)}
                last={last}
                operator={kind === 'GROUP' && operatorIds.includes(m.senderId)}
                onOpenImage={onOpenImage}
                onMenu={onMenu}
              />
            </Fragment>
          );
        })}
        {pending.map((p, j) => (
          <Fragment key={p.tempId}>
            {showsDayDivider(flat, messages.length + j) && <DayDivider iso={p.createdAt} />}
            <PendingBubble p={p} onRetry={onRetry} onDiscard={onDiscard} />
          </Fragment>
        ))}
      </div>
      {unseen > 0 && (
        <button
          type="button"
          onClick={() => { scrollDown(true); setUnseen(0); }}
          className="absolute bottom-3 left-1/2 flex h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-gray-300 bg-white px-4 text-[13px] font-medium text-gray-900"
        >
          새 메시지 {unseen > 99 ? '99+' : unseen}
          <ArrowDown size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator" aria-label={dividerLabel(iso)}>
      <span className="h-px flex-1 bg-gray-200" />
      <span className="text-xs text-gray-600">{dividerLabel(iso)}</span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}
