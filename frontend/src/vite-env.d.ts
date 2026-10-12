/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 시 주입되는 빌드 식별자.
// 빌드마다 새로 정하는 값(artlook 자산 주소 등). ⚠️ 서비스워커 등록 주소에는 쓰지 않는다(main.tsx — 배포 뒤 새로고침이 두 번 일어났다).
declare const __BUILD_ID__: string;
