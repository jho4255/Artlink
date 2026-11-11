import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // 파일 간 순차 실행 — 테스트 DB 충돌 방지
    fileParallelism: false,
    // 단일 스레드 강제 — 모든 테스트가 하나의 워커에서 실행 (DB 커넥션 공유)
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // setup-mail: 테스트에서 메일을 보내지 않는다(2026-10-08) · setup: 테스트 DB·마이그레이션
    // setup-push: 앱 푸시를 보내지 않고 App Links 지문도 비운다(2026-11-09) — 필요한 테스트만 켠다
    setupFiles: ['./src/__tests__/setup-mail.ts', './src/__tests__/setup-push.ts', './src/__tests__/setup.ts'],
    testTimeout: 15000,
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
