import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { queryClient } from '@/lib/queryClient';
import { controllerChangeReloader } from '@/lib/swUpdate';
import App from './App';
import ScrollToTop from '@/components/layout/ScrollToTop';
import AppToaster from '@/components/layout/AppToaster';
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
  // 새 버전 워커로 바뀌면 페이지 새로고침 — ⚠️ 처음 설치(관리자 없던 페이지)는 업데이트가 아니므로 새로고침하지 않는다.
  // 예전엔 첫 방문자의 페이지가 7초쯤에 저절로 다시 불러와졌다(lib/swUpdate.ts).
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    controllerChangeReloader(!!navigator.serviceWorker.controller, () => window.location.reload()),
  );

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
        {/* 경로가 바뀌면 맨 위에서 — App 보다 앞에 둔다(딥링크 화면의 카드 스크롤이 이 뒤에 덮도록) */}
        <ScrollToTop />
        <App />
        {/* 좁은 화면은 위쪽, 넓은 화면은 아래 — z-index·위치의 이유는 AppToaster 주석 */}
        <AppToaster />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
