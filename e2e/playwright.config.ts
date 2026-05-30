import { defineConfig, devices } from '@playwright/test';

/**
 * ArtLink E2E 설정
 * - 로컬 서버 대상만 (frontend :5173, backend :4000). 실서버(artlink.cc) 절대 사용 금지.
 * - globalSetup: 매 실행 전 DB 시드 리셋 + 역할별 로그인 세션(storageState) 생성.
 * - 멀티유저 상호작용 테스트가 공유 DB를 쓰므로 workers=1(직렬)로 안정성 우선.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 375, height: 812 }, // 모바일 PWA 기준
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
