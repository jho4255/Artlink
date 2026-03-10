import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import { queryClient } from '@/lib/queryClient';
import App from './App';
import './index.css';

// PWA 서비스워커 업데이트 감지 → 자동 새로고침 안내
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then((registration) => {
    registration.addEventListener('controllerchange', () => {
      // 새 서비스워커가 활성화되면 페이지 새로고침
      window.location.reload();
    });
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
        <Toaster position="bottom-center" toastOptions={{
          duration: 3000,
          style: { fontSize: '14px', borderRadius: '12px' },
        }} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
