import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Bell, BellOff, MoreHorizontal } from 'lucide-react';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import { chatRoleTag, chatTitle } from '@/lib/chatView';
import { chatsChanged } from '@/lib/chatCache';
import type { AttachmentType, ChatMessage, ChatReportReason, ChatSummary } from '@/lib/chatTypes';
import { useChatRoom } from '@/hooks/useChatRoom';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { PersonAvatar, PosterAvatar } from './ChatAvatar';
import RefCard from './RefCard';
import MessageList from './MessageList';
import Composer from './Composer';
import { MembersSheet, MessageMenuSheet, ReportSheet, RoomMenuSheet } from './RoomSheets';

/**
 * 대화방 하나 (2026-11-19 개편 — 목업 ②③④⑥). 부모가 `key={chatId}` 로 그린다 — 방을 바꾸면 상태가 통째로 새로 시작한다.
 *
 * 휴대폰: 머리 [←] · 얼굴 · 이름(+ '작가 · 홈페이지 보기') · [⋯] / 맥락 카드 / 대화 / 입력 줄 — **대화 전용 화면**(상단바·하단 탭바 없음, 부모가 높이를 준다)
 * 넓은 화면: 오른쪽 칸. 머리에 알림 종을 바로 둔다.
 */
type ApiError = { response?: { status?: number; data?: { error?: string } } };
const errText = (e: unknown, fb: string) => (e as ApiError)?.response?.data?.error || fb;

export default function ChatRoom({ chatId, myId, wide, onBack }: { chatId: number; myId: number; wide: boolean; onBack: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const room = useChatRoom(chatId, myId);
  const { meta, setMeta } = room;
  const [menu, setMenu] = useState(false);
  const [members, setMembers] = useState(false);
  const [msgMenu, setMsgMenu] = useState<ChatMessage | null>(null);
  const [report, setReport] = useState<{ message: ChatMessage | null } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  const title = meta ? chatTitle(meta, myId) : '';
  const counterpart = meta?.counterpart ?? null;

  const onOpenImage = useCallback((url: string) => {
    const images = room.messages.filter((m) => m.attachmentType === 'IMAGE' && m.attachmentUrl).map((m) => m.attachmentUrl!);
    setLightbox({ images, index: Math.max(0, images.indexOf(url)) });
  }, [room.messages]);
  const onMenu = useCallback((m: ChatMessage) => setMsgMenu(m), []);

  const onFiles = (files: File[], type: AttachmentType) => {
    const problem = room.sendFiles(files, type);
    if (problem) toast.error(problem);
  };

  const toggleMute = async () => {
    if (!meta) return;
    setMenu(false);
    try {
      const { data } = await api.patch(`/chats/${chatId}/mute`, { muted: !meta.muted });
      setMeta((m) => (m ? { ...m, muted: data.muted } : m));
      qc.setQueryData<ChatSummary[]>(['chats'], (old) => old?.map((c) => (c.id === chatId ? { ...c, muted: data.muted } : c)));
      toast.success(data.muted ? '이 대화방 알림을 껐어요.' : '이 대화방 알림을 켰어요.');
    } catch (e) { toast.error(errText(e, '알림 설정을 바꾸지 못했어요.')); }
  };

  const setHidden = async (hidden: boolean) => {
    setMenu(false);
    try {
      await api.patch(`/chats/${chatId}/hidden`, { hidden });
      setMeta((m) => (m ? { ...m, hidden } : m));
      chatsChanged(qc);
      if (hidden) {
        toast((t) => (
          <span className="flex items-center gap-3 text-sm">
            목록에서 숨겼어요.
            <button type="button" className="font-medium underline underline-offset-4" onClick={() => { toast.dismiss(t.id); void setHidden(false); }}>되돌리기</button>
          </span>
        ), { duration: 5000 });
        onBack();
      } else toast.success('목록에 다시 보여요.');
    } catch (e) { toast.error(errText(e, '바꾸지 못했어요.')); }
  };

  const block = async () => {
    if (!counterpart) return;
    setConfirmBlock(false);
    try {
      await api.post('/blocks', { userId: counterpart.id });
      setMeta((m) => (m ? { ...m, canSend: false, blockReason: 'blocked' } : m));
      chatsChanged(qc);
      void qc.invalidateQueries({ queryKey: ['blocks'] });
      toast.success(`${displayName(counterpart)} 님을 차단했어요.`);
    } catch (e) { toast.error(errText(e, '차단하지 못했어요.')); }
  };
  const unblock = async () => {
    if (!counterpart) return;
    setMenu(false);
    try {
      await api.delete(`/blocks/${counterpart.id}`);
      setMeta((m) => (m ? { ...m, canSend: !counterpart.deleted, blockReason: counterpart.deleted ? 'deleted' : null } : m));
      chatsChanged(qc);
      void qc.invalidateQueries({ queryKey: ['blocks'] });
      toast.success('차단을 풀었어요.');
    } catch (e) { toast.error(errText(e, '차단을 풀지 못했어요.')); }
  };

  const submitReport = async (reason: ChatReportReason, detail: string) => {
    if (!report) return;
    setReporting(true);
    try {
      await api.post(`/chats/${chatId}/report`, { messageId: report.message?.id ?? null, reason, detail: detail || null });
      toast.success('신고했어요. 운영팀이 확인할게요.');
      setReport(null);
    } catch (e) { toast.error(errText(e, '신고하지 못했어요.')); }
    finally { setReporting(false); }
  };

  if (room.error === 'notfound') {
    return (
      <section className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-10 text-sm text-gray-600">
        <p>대화를 찾을 수 없어요.</p>
        <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-300 px-4 text-gray-900 hover:bg-gray-50">
          <ArrowLeft size={16} aria-hidden /> 대화 목록으로
        </button>
      </section>
    );
  }

  const sub = meta?.kind === 'GROUP'
    ? null
    : counterpart && !counterpart.deleted
      ? [chatRoleTag(counterpart.role), counterpart.galleryName && counterpart.galleryName !== displayName(counterpart) ? counterpart.galleryName : null].filter(Boolean).join(' · ')
      : null;

  return (
    <section aria-label={title ? `${title} 대화` : '대화'} data-testid="chat-room" className="flex h-full min-h-0 flex-col bg-white">
      {/* 머리 */}
      <header className={`flex shrink-0 items-center gap-2 border-b border-gray-200 ${wide ? 'h-[68px] px-6' : 'h-14 pl-1 pr-1'}`}>
        {!wide && (
          <button type="button" onClick={onBack} aria-label="대화 목록으로" className="grid h-11 w-11 shrink-0 place-items-center text-gray-900">
            <ArrowLeft size={22} aria-hidden />
          </button>
        )}
        {meta?.kind === 'GROUP'
          ? <PosterAvatar src={meta.exhibition?.imageUrl} size={wide ? 40 : 36} />
          : <PersonAvatar person={counterpart} size={wide ? 40 : 36} />}
        <div className="min-w-0 flex-1 pl-1">
          <h2 className="truncate text-[15px] font-bold text-gray-900 lg:text-base" data-testid="chat-title">{title || ' '}</h2>
          <p className="truncate text-xs text-gray-600">
            {meta?.kind === 'GROUP' ? (
              <>
                <button type="button" onClick={() => setMembers(true)} className="underline-offset-2 hover:underline">참여자 {meta.participants.length}</button>
                {meta.exhibition && <> · <Link to={`/exhibitions/${meta.exhibition.id}`} className="underline-offset-2 hover:underline">공모 보기</Link></>}
              </>
            ) : (
              <>
                {sub}
                {counterpart?.homepage && <>{sub ? ' · ' : ''}<Link to={counterpart.homepage} className="underline-offset-2 hover:underline">홈페이지 보기</Link></>}
                {counterpart?.deleted && '탈퇴한 회원'}
              </>
            )}
          </p>
        </div>
        {meta && wide && (
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={meta.muted}
            aria-label={meta.muted ? '이 대화방 알림 켜기' : '이 대화방 알림 끄기'}
            title={meta.muted ? '알림 꺼짐' : '알림 켜짐'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            {meta.muted ? <BellOff size={19} aria-hidden /> : <Bell size={19} aria-hidden />}
          </button>
        )}
        {meta && (
          <button type="button" onClick={() => setMenu(true)} aria-label="대화방 메뉴" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-900 hover:bg-gray-100">
            <MoreHorizontal size={22} aria-hidden />
          </button>
        )}
      </header>

      {/* 맥락 카드 — 가장 최근 것 하나를 고정 */}
      {meta?.context && <RefCard refItem={meta.context} pinned />}

      {room.error === 'network' && !room.messages.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-sm text-gray-600">
          <p>대화를 불러오지 못했어요.</p>
          <button type="button" onClick={() => window.location.reload()} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-gray-900">다시 시도</button>
        </div>
      ) : (
        <MessageList
          kind={meta?.kind ?? 'DIRECT'}
          myId={myId}
          messages={room.messages}
          pending={room.pending}
          hasMore={room.hasMore}
          loadingOlder={room.loadingOlder}
          loaded={room.loaded}
          operatorIds={meta?.operatorIds ?? []}
          emptyText="첫 메시지를 보내 보세요."
          onLoadOlder={room.loadOlder}
          onOpenImage={onOpenImage}
          onMenu={onMenu}
          onRetry={room.retry}
          onDiscard={room.discard}
        />
      )}

      {/* 입력 줄 — 보낼 수 없는 방이면 그 이유 한 줄 */}
      {meta && !meta.canSend ? (
        <div className="shrink-0 border-t border-gray-200 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3.5 text-center text-sm text-gray-600" data-testid="chat-blocked">
          {meta.blockReason === 'blocked' ? (
            <>차단한 상대예요. <button type="button" onClick={unblock} className="min-h-[36px] font-medium text-gray-900 underline underline-offset-4">차단 풀기</button></>
          ) : meta.blockReason === 'deleted' ? '탈퇴한 회원이에요. 메시지를 보낼 수 없어요.' : '메시지를 보낼 수 없는 상대예요.'}
        </div>
      ) : (
        <Composer key={chatId} chatId={chatId} disabled={!meta} onSend={(t) => room.sendText(t)} onFiles={onFiles} />
      )}

      {menu && meta && (
        <RoomMenuSheet
          meta={meta}
          myTitle={title}
          onClose={() => setMenu(false)}
          onToggleMute={toggleMute}
          onToggleHidden={() => void setHidden(!meta.hidden)}
          onReport={() => { setMenu(false); setReport({ message: null }); }}
          onBlock={() => { setMenu(false); setConfirmBlock(true); }}
          onUnblock={unblock}
          onMembers={() => { setMenu(false); setMembers(true); }}
          onNavigate={(to) => { setMenu(false); navigate(to); }}
        />
      )}
      {members && meta && <MembersSheet meta={meta} myId={myId} onClose={() => setMembers(false)} />}
      {msgMenu && (
        <MessageMenuSheet
          message={msgMenu}
          mine={msgMenu.senderId === myId}
          onClose={() => setMsgMenu(null)}
          onCopy={() => {
            const text = msgMenu.content;
            setMsgMenu(null);
            void navigator.clipboard?.writeText(text).then(() => toast.success('복사했어요.'), () => toast.error('복사하지 못했어요.'));
          }}
          onReport={() => { const m = msgMenu; setMsgMenu(null); setReport({ message: m }); }}
        />
      )}
      {report && (
        <ReportSheet
          targetName={report.message ? displayName(report.message.sender) : displayName(counterpart ?? { name: '상대' })}
          messageText={report.message?.content || null}
          busy={reporting}
          onClose={() => setReport(null)}
          onSubmit={submitReport}
        />
      )}
      <ConfirmDialog
        open={confirmBlock}
        title="차단할까요?"
        message={`${counterpart ? displayName(counterpart) : '상대'} 님과 서로 메시지를 보낼 수 없게 돼요.`}
        details={['이 대화는 내 목록에서 빠져요(대화는 지워지지 않아요).', '차단은 프로필의 [차단한 사람]에서 언제든 풀 수 있어요.']}
        confirmText="차단하기"
        variant="danger"
        onConfirm={block}
        onCancel={() => setConfirmBlock(false)}
      />
      <AnimatePresence>
        {lightbox && <ImageLightbox images={lightbox.images} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </section>
  );
}
