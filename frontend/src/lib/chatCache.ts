import type { QueryClient } from '@tanstack/react-query';
import type { ChatSummary } from './chatTypes';

/**
 * ArtTalk 캐시 규칙 (2026-11-19 — 사용자 신고 "문의를 보냈는데 ArtTalk 에 아무것도 없다가 한참 뒤에 나타났다").
 *
 * 원인은 서버가 아니라 이 캐시였다. 메시지는 보낸 즉시 저장됐는데 —
 *  ① 작가 홈페이지 [문의하기]·공모 상세·작품 창이 보낸 뒤 대화 목록(`['chats']`)을 **다시 받게 하지 않았고**
 *  ② 목록 쿼리가 전역 staleTime(5분)이라 ArtTalk 에 다시 들어가도 받지 않았다(15초 폴링만 남는데, 탭이 가려지면 그것도 멈춘다).
 * 실측(가상 계정): 보낸 직후 PC 목록이 15.4초 동안 '아직 대화가 없습니다' · 휴대폰 [←] 뒤 빈 목록 · 받는 쪽은 방을 읽은 뒤에도 배지가 27초.
 *
 * ⚠️ **ArtTalk 밖에서 `/chats/…` 로 쓰는 곳은 전부 `chatsChanged` 를 부를 것** — `chatCache.test.ts` 가 소스를 훑어 막는다.
 */
export function chatsChanged(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['chats'] });
  void qc.invalidateQueries({ queryKey: ['chat-unread'] });
}

/**
 * 방을 읽었다 — 서버는 방을 열 때(·새 말을 받아 올 때) 읽음을 적고 그 방 알림도 읽음 처리한다.
 * 화면 쪽 숫자도 곧바로 맞춘다: 목록의 그 방 안 읽은 수 0 · 상단 배지·벨 숫자 다시 받기.
 * (예전엔 30초 배지 폴링을 기다려 방을 읽은 뒤에도 배지가 27초 남았다)
 */
export function chatRead(qc: QueryClient, chatId: number): void {
  qc.setQueryData<ChatSummary[]>(['chats'], (old) => old?.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c)));
  void qc.invalidateQueries({ queryKey: ['chat-unread'] });
  void qc.invalidateQueries({ queryKey: ['unread-count'] });
  void qc.invalidateQueries({ queryKey: ['notifications'] });
}

/** 앱 푸시·다른 화면이 "이 방(또는 아무 방)에 새 말이 왔다"고 알린다 — 열려 있는 방이 다음 폴링을 기다리지 않고 바로 받는다 */
export const CHAT_POKE_EVENT = 'artlink:chat-poke';
export function pokeChat(chatId?: number | null): void {
  try { window.dispatchEvent(new CustomEvent(CHAT_POKE_EVENT, { detail: { chatId: chatId ?? null } })); } catch { /* 던지지 않는다 */ }
}

/** 방마다 쓰던 글 — 이 탭에만(sessionStorage). 로그아웃하면 지운다(`clearChatDrafts`) */
const DRAFT_PREFIX = 'artlink-chat-draft:';
export function readChatDraft(chatId: number): string {
  try { return sessionStorage.getItem(DRAFT_PREFIX + chatId) ?? ''; } catch { return ''; }
}
export function writeChatDraft(chatId: number, text: string): void {
  try {
    if (text) sessionStorage.setItem(DRAFT_PREFIX + chatId, text);
    else sessionStorage.removeItem(DRAFT_PREFIX + chatId);
  } catch { /* 막힌 환경 */ }
}
export function clearChatDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* 막힌 환경 */ }
}
