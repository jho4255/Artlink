import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { stashBeforeAuthLoss } from '@/lib/authStash';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * 401 이어도 로그아웃시키지 않는다(2026-11-13, 커뮤니티 글 자동 저장). 쓰는 도중 로그인이 풀리면 화면이 로그인으로 튕겨
     * 쓰던 글을 볼 수 없게 되므로, 글쓰기 화면이 직접 "다시 로그인해 주세요"를 띄우고 글은 이 기기에 보관한다.
     */
    skipAuthLogout?: boolean;
  }
}

// Axios 인스턴스 생성 - 추후 배포 시 baseURL 변경 용이
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000, // 15초 타임아웃 (서버 응답 대기 상한)
});

// 요청 인터셉터 - JWT 토큰 자동 첨부 + FormData Content-Type 자동 설정
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // FormData 전송 시 Content-Type 삭제 → 브라우저가 boundary 포함 자동 설정
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// 응답 인터셉터 - 401 시 자동 로그아웃 + 에러 로깅
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 로그인 시도(/auth/*) 실패의 401은 기존 세션을 날리지 않도록 로그아웃 제외
    if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/') && !error.config?.skipAuthLogout) {
      // 로그인이 풀렸다 — 내보내기 전에 화면들의 저장 안 된 입력을 이 기기에 남긴다(다시 로그인하면 그 화면이 되살린다, lib/authStash)
      stashBeforeAuthLoss(useAuthStore.getState().user?.id);
      useAuthStore.getState().logout({ expired: true });
    }
    // 네트워크/타임아웃/서버 에러 로깅 (개발 환경)
    if (!error.response) {
      console.error('[API] 네트워크 에러 또는 타임아웃:', error.config?.url, error.message);
    } else if (error.response.status >= 500) {
      console.error('[API] 서버 에러:', error.config?.url, error.response.status, error.response.data);
    }
    return Promise.reject(error);
  }
);

export default api;
