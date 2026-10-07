/**
 * Vitest 전역 setup — 테스트 DB 환경 설정 및 마이그레이션
 * setupFiles에서 각 테스트 프로세스 시작 전 1회 실행
 */
import { execSync } from 'child_process';

// 테스트 전용 DB URL 설정
process.env.DATABASE_URL = 'postgresql://artlink:artlink_dev_password@localhost:5432/artlink_test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';
// 메일은 절대 보내지 않는다(2026-10-08) — backend/.env 에 SMTP 설정이 있어도. 빈 값을 먼저 넣어 두면 dotenv 가 덮어쓰지 않는다.
// (테스트가 NODE_ENV 를 잠깐 production 으로 바꾸는 경우에도 SMTP 로 나가지 않게 — lib/mailer.ts)
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.MAIL_TRANSPORT = 'log';

// 테스트 DB에 마이그레이션 적용 (기존 스키마 동기화)
execSync('npx prisma migrate deploy', {
  cwd: __dirname + '/../..',
  env: { ...process.env },
  stdio: 'pipe',
});
