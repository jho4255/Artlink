import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';

// Axios 인스턴스 생성 - 추후 배포 시 baseURL 변경 용이
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
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

// 응답 인터셉터 - 401 시 자동 로그아웃
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;
