import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryClient } from '@/lib/queryClient';
import { disarmHomepageNudge } from '@/lib/homepageNudge';
import { clearArtLookForLogout } from '@/lib/artlook';
import { forgetPushToken } from '@/lib/native';
import { clearChatDrafts } from '@/lib/chatCache';
import { clearAuthStashes } from '@/lib/authStash';

interface User {
  id: number;
  name: string;
  nickname?: string | null;
  /** 홈페이지 주소 /@handle (작가). 없으면 숫자 주소 */
  handle?: string | null;
  email: string;
  role: string;
  avatar?: string;
  phone?: string | null;
  instagramUrl?: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  /** expired — 로그인이 풀려서(401) 내보내는 것. 그땐 이 기기에 남긴 입력(authStash)을 지우지 않는다 — 다시 로그인하면 되살린다 */
  logout: (opts?: { expired?: boolean }) => void;
  updateUser: (user: Partial<User>) => void;
}

// 인증 상태 관리 (localStorage 영속화)
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      // 계정이 바뀌면 이전 계정 기준으로 캐시된 응답(좋아요 여부·찜·내 목록 등)을 반드시 버린다.
      // 남겨두면 "좋아요를 눌렀는데 하트가 안 켜짐" 같은 상태 불일치가 생긴다.
      login: (token, user) => {
        queryClient.clear();
        set({ token, user, isAuthenticated: true });
      },
      logout: (opts) => {
        queryClient.clear();
        disarmHomepageNudge(); // 예약해 둔 '홈페이지 완성' 팝업은 그 계정의 것이다
        clearArtLookForLogout();   // ArtLook 으로 넘겨 둔 작품 목록·고른 크기도 — 같은 컴퓨터의 다음 사람에게 앞사람 작품이 뜬다
        forgetPushToken();     // 앱: 이 기기로 가던 알림을 끊는다(만료로 자동 로그아웃될 때도 — 토큰이 자격이라 인증 없이 지운다)
        clearChatDrafts();     // ArtTalk 방마다 쓰던 글 — 같은 기기의 다음 사람에게 보이지 않게
        // 사람이 [로그아웃]을 눌렀으면 이 기기에 남긴 입력도 지운다. 로그인이 풀려 내보낼 때(401)는 남긴다 — 다시 로그인하면 되살린다(lib/authStash)
        if (opts?.expired !== true) clearAuthStashes();
        set({ token: null, user: null, isAuthenticated: false });
      },
      updateUser: (partial) => set((state) => ({
        user: state.user ? { ...state.user, ...partial } : null,
      })),
    }),
    { name: 'artlink-auth' }
  )
);
