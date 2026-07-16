import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// DEV_HTTPS=true 로 띄우면 self-signed HTTPS (인스타 OAuth redirect 로컬 테스트용)
const useHttps = process.env.DEV_HTTPS === 'true';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true, // 이전 배포의 precache(오래된 청크) 정리 → 흰 화면 유발 감소
        // API/업로드 경로는 SPA 앱셸(index.html)로 폴백하지 않도록 제외
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
      },
      manifest: {
        name: 'ArtLink',
        short_name: 'ArtLink',
        description: '갤러리와 아티스트를 잇다',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 캐시 무효화: 모든 번들/에셋 파일명에 콘텐츠 해시([hash])를 강제로 포함.
  // 내용이 바뀌면 파일명(=버전)이 바뀌므로 브라우저·CDN이 무조건 새 파일을 받는다.
  // (Vite 기본값과 동일하지만, 실수로 해싱이 꺼지는 것을 막기 위해 명시적으로 고정)
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': process.env.VITE_API_URL || 'http://localhost:4000',
      '/uploads': process.env.VITE_API_URL || 'http://localhost:4000',
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
