/**
 * 테스트에서는 메일을 절대 보내지 않는다(2026-10-08) — backend/.env 에 SMTP 설정이 있어도.
 * 빈 값을 먼저 넣어 두면 dotenv 가 덮어쓰지 않는다. 테스트가 NODE_ENV 를 잠깐 production 으로 바꾸는 경우에도
 * SMTP 로 나가지 않게 한다(lib/mailer.ts — 테스트 환경이면 원래 보내지 않지만, 운영 흉내를 낼 때를 위한 두 번째 잠금).
 * ⚠️ setup.ts 와 따로 둔 이유: setup.ts 에는 로컬 테스트 DB 주소가 있어, 그 파일을 고치면 배포 전 점검(predeploy-check)이 막는다.
 */
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.MAIL_TRANSPORT = 'log';
