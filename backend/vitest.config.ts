import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // 파일 간 순차 실행 — 테스트 DB 충돌 방지 (Vitest 4)
    fileParallelism: false,
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
