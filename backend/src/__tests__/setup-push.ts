/**
 * 테스트에서는 앱 푸시를 보내지 않는다(2026-11-09, 규칙 79) — backend/.env 에 Firebase 서비스 계정이 있어도.
 * 빈 값을 먼저 넣어 두면 dotenv 가 덮어쓰지 않는다(setup-mail.ts 와 같은 방식). 푸시·App Links 테스트는 각자 켜고 끝나면 되돌린다.
 */
process.env.FIREBASE_SERVICE_ACCOUNT = '';
process.env.PUSH = '';
process.env.ANDROID_CERT_SHA256 = '';
