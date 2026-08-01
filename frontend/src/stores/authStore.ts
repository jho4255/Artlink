import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryClient } from '@/lib/queryClient';

interface User {
  id: number;
  name: string;
  nickname?: string | null;
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
  logout: () => void;
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
      logout: () => {
        queryClient.clear();
        set({ token: null, user: null, isAuthenticated: false });
      },
      updateUser: (partial) => set((state) => ({
        user: state.user ? { ...state.user, ...partial } : null,
      })),
    }),
    { name: 'artlink-auth' }
  )
);
