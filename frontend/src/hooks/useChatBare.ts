import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * ArtTalk 대화방을 **휴대폰 대화 전용 화면**으로 띄우는가 (2026-11-19 개편) — `/messages?chat=<id>` · 로그인 · 창 폭 1024px 미만.
 * 그때 `Layout` 은 상단바·하단 탭바·푸터를 그리지 않는다(카카오톡처럼 대화가 화면을 다 쓰고, 입력 줄이 자판 바로 위에 붙는다).
 * 예전엔 페이지 안의 상자라 위로 로고·제목, 아래로 회사 정보·탭바가 있고 대화 칸이 화면의 55% 였다 — 자판이 뜨면 두세 줄만 보였다.
 * ⚠️ 넓은 화면(1024px 이상)은 상단바·오른쪽 메뉴 안에서 두 칸으로 보인다 — 경계는 `CHAT_WIDE_MEDIA` 하나(MessagesPage 와 같은 값).
 */
export const CHAT_WIDE_MEDIA = '(min-width: 1024px)';

export function isChatRoomPath(pathname: string, search: string): boolean {
  if (pathname.replace(/\/+$/, '') !== '/messages') return false;
  return Number(new URLSearchParams(search).get('chat')) > 0;
}

export function useChatBare(): boolean {
  const { pathname, search } = useLocation();
  const wide = useMediaQuery(CHAT_WIDE_MEDIA);
  const authed = useAuthStore((s) => s.isAuthenticated);
  return !wide && authed && isChatRoomPath(pathname, search);
}
