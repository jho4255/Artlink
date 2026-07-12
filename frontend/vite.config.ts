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
