import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { queryClient } from '@/lib/queryClient';
import { controllerChangeReloader, reloadIfStale } from '@/lib/swUpdate';
import App from './App';
import ScrollToTop from '@/components/layout/ScrollToTop';
import AppToaster from '@/components/layout/AppToaster';
import './index.css';

// PWA 서비스워커 등록 + 업데이트 감지 → 자동 새로고침 안내
if ('serviceWorker' in navigator) {
  // ⚠️⚠️ 등록 주소는 **고정**(/sw.js)이다 — 빌드마다 바뀌는 주소(`/sw.js?v=빌드ID`)로 되돌리지 말 것 (2026-10-12).
  //    주소가 빌드마다 다르면 배포 뒤 처음 들어온 사람은 새로고침이 **두 번** 일어난다: 옛 판이 옛 주소로 새 워커를 받아 한 번,
  //    새 판이 새 주소로 같은 워커를 또 설치해 한 번. 두 번째 새로고침이 막 뜬 '홈페이지 완성' 팝업을 0.5초 만에 지웠다
  //    (실서버 '초원', 재현 scratchpad/homepage-edit/returning-artist.js). 비회원 통계에 첫 화면이 겹쳐 잡히는 것도 같은 원인이다.
  //    빌드 ID 를 붙였던 이유(2026-07: Cloudflare 가 /sw.js 를 오래 붙잡아 새 워커가 안 퍼졌다)는 이제 서버가 막는다 —
  //    sw.js 는 no-store 로 나가고(backend lib/staticCache.ts, static-cache.test.ts) Cloudflare 도 BYPASS 다(2026-10-12 실측).
  //    `updateViaCache: 'none'` 으로 브라우저 HTTP 캐시도 거치지 않고 매번 서버에 묻는다.
  //    (vite-plugin-pwa의 registerSW.js 자동 생성은 비활성 — vite.config.ts injectRegister: null)
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    });
  }

  // controllerchange는 registration이 아닌 serviceWorker 컨테이너에서 발생.
  // 새 버전 워커로 바뀌면 페이지 새로고침 — ⚠️ 처음 설치(관리자 없던 페이지)는 업데이트가 아니므로 새로고침하지 않는다.
  // 예전엔 첫 방문자의 페이지가 7초쯤에 저절로 다시 불러와졌다(lib/swUpdate.ts).
  // ⚠️ 그리고 이 페이지가 이미 최신 판이면(서버의 지금 index.html 과 같은 묶음) 새로고침하지 않는다 — reloadIfStale(2026-10-12).
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    controllerChangeReloader(!!navigator.serviceWorker.controller, () => {
      void reloadIfStale(
        () => fetch('/', { cache: 'no-store', credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))),
        () => Array.from(document.scripts, (sc) => sc.src),
        () => window.location.reload(),
      );
    }),
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
