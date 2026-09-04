-- 가입 시 약관·개인정보 동의 기록.
-- 기존 회원은 NULL — 소급해서 동의한 것으로 치지 않는다(동의를 받은 적이 없으므로).
ALTER TABLE "User" ADD COLUMN "termsAgreedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "privacyAgreedAt" TIMESTAMP(3);
