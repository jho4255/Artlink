import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import { TOAST_OPTIONS } from '@/lib/toastOptions';
import { queryClient } from '@/lib/queryClient';
import App from './App';
import './index.css';

// PWA 서비스워커 등록 + 업데이트 감지 → 자동 새로고침 안내
if ('serviceWorker' in navigator) {
  // 등록 URL에 빌드 ID 쿼리를 붙여 CDN(Cloudflare) 엣지 캐시를 우회한다.
  // 고정 URL(/sw.js)은 엣지에 장기 캐시되면 신버전 워커가 영영 배포되지 않는 사고가
  // 실제로 발생(2026-07). 쿼리가 캐시 키에 포함되므로 빌드마다 반드시 새로 받는다.
  // (vite-plugin-pwa의 registerSW.js 자동 생성은 비활성 — vite.config.ts injectRegister: null)
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`, { scope: '/' });
    });
  }

  // controllerchange는 registration이 아닌 serviceWorker 컨테이너에서 발생.
  // 새 서비스워커가 활성화되면 페이지 새로고침 (reload 루프 방지 가드 포함)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATED') {
      toast('새 버전이 적용되었습니다!', { icon: '🔄' });
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        {/* z-index: 모달(z-9999)·중첩 모달(z-10000) 위에 떠야 한다.
            어두운 오버레이 뒤로 토스트가 가려져 "이미 지원한 작가입니다" 같은 안내를 못 보는 문제가 있었다.
            duration 등 세부 설정과 그 이유는 lib/toastOptions.ts 참고. */}
        <Toaster position="bottom-center" containerStyle={{ zIndex: 100000 }} toastOptions={TOAST_OPTIONS} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
