import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // 파일 간 순차 실행 — 테스트 DB 충돌 방지
    fileParallelism: false,
    // 단일 스레드 강제 — 모든 테스트가 하나의 워커에서 실행 (DB 커넥션 공유)
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
