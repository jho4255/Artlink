/**
 * ArtTalk(대화) 화면이 주고받는 모양 — 서버 `backend/src/lib/chat.ts`(listChats·readChat)·`lib/chatRef.ts` 와 같은 모양이다.
 * 한쪽 필드를 바꾸면 여기도 바꿀 것(타입이 서버를 못 보므로 테스트 `chatView.test.ts`·e2e `85-arttalk` 가 잡는다).
 */
export type ChatKind = 'DIRECT' | 'GROUP';
export type AttachmentType = 'IMAGE' | 'VIDEO' | 'FILE';

export interface ChatPerson {
  id: number;
  name: string;
  nickname?: string | null;
  avatar?: string | null;
  role?: string;
  /** 탈퇴한 회원(이름은 이미 '탈퇴한 회원') — 옛 서버 응답엔 없다 */
  deleted?: boolean;
}

/** 맥락 카드 — 무엇에 대한 말인가. **서버가 만든다**(화면은 `{type,id}` 만 보낸다) */
export type ChatRefType = 'WORK' | 'EXHIBITION' | 'SHOW' | 'GALLERY';
export interface ChatRef {
  type: ChatRefType;
  id: number;
  title: string;
  sub: string | null;
  image: string | null;
  /** 우리 사이트 경로 */
  link: string;
}

export interface ChatSummary {
  id: number;
  kind: ChatKind;
  title: string | null;
  exhibitionId: number | null;
  /** 단톡의 얼굴 — 공모 포스터 */
  cover?: string | null;
  lastMessageAt: string;
  unread: number;
  /** 내가 이 방 알림을 껐는가(옛 서버 응답엔 없다) */
  muted?: boolean;
  participants: ChatPerson[];
  lastMessage: { content: string; senderId: number; senderName?: string; createdAt: string } | null;
}

export interface ChatMessage {
  id: number;
  senderId: number;
  content: string;
  createdAt: string;
  sender: ChatPerson;
  read: boolean | null;
  unreadBy: number | null;
  attachmentUrl?: string | null;
  attachmentType?: AttachmentType | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  ref?: ChatRef | null;
}

/** 1:1 상대 — 홈페이지 주소까지(방을 열 때만 온다) */
export interface ChatCounterpart extends ChatPerson {
  homepage: string | null;
  galleryName: string | null;
}

/** 보낼 수 없는 이유 — 누가 막았는지는 알리지 않는다('unavailable') */
export type ChatBlockReason = 'deleted' | 'blocked' | 'unavailable';

/** 방의 머리 정보 — 방을 열 때 받고, 폴링은 바뀌는 것(알림·숨김·참여자·읽음)만 덮는다 */
export interface ChatRoomMeta {
  id: number;
  kind: ChatKind;
  title: string | null;
  exhibition: { id: number; title: string; imageUrl?: string | null } | null;
  participants: ChatPerson[];
  muted: boolean;
  hidden: boolean;
  /** 작가에게 열린 방인가 — 단톡은 운영자의 첫 메시지 뒤에 열린다(2026-11-19). 갠톡은 늘 true */
  opened: boolean;
  counterpart: ChatCounterpart | null;
  operatorIds: number[];
  context: (ChatRef & { messageId: number }) | null;
  canSend: boolean;
  blockReason: ChatBlockReason | null;
}

/** `GET /chats/:id` 응답 — 폴링(`after`)엔 머리 정보(counterpart·context·canSend…)가 없다 */
export interface ChatDetailResponse {
  id: number;
  kind: ChatKind;
  title: string | null;
  exhibition: { id: number; title: string; imageUrl?: string | null } | null;
  participants: ChatPerson[];
  otherCount: number;
  messages: ChatMessage[];
  muted?: boolean;
  hidden?: boolean;
  opened?: boolean;
  hasMore?: boolean;
  readers?: { userId: number; lastReadAt: string | null }[];
  counterpart?: ChatCounterpart | null;
  operatorIds?: number[];
  context?: (ChatRef & { messageId: number }) | null;
  canSend?: boolean;
  blockReason?: ChatBlockReason | null;
}

/** 보내는 중인 말 — 화면에만 있다(서버 응답이 오면 진짜 메시지로 바뀐다) */
export interface PendingMessage {
  tempId: string;
  createdAt: string;
  content: string;
  ref?: { type: ChatRefType; id: number } | null;
  /** 사진·동영상·파일 — 올리는 중이면 미리보기 주소(blob:) */
  file?: File;
  attachmentType?: AttachmentType;
  previewUrl?: string;
  status: 'sending' | 'failed';
  error?: string;
}

export const CHAT_REPORT_REASONS = [
  ['SPAM', '스팸·광고'],
  ['ABUSE', '욕설·비방'],
  ['SCAM', '사기 의심'],
  ['ETC', '기타'],
] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number][0];
