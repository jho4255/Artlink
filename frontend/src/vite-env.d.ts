/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 시 주입되는 빌드 식별자.
// 서비스워커 등록 URL(/sw.js?v=...)의 캐시 버스팅에 사용.
declare const __BUILD_ID__: string;
