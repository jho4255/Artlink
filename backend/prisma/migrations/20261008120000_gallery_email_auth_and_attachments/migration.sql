-- 갤러리 이메일 가입(인증번호) · 공모 첨부파일 (2026-10-08)
-- 이메일을 인증번호로 확인한 시각. NULL = 확인한 적 없는 주소(카카오 가입 등) — 기존 회원은 전부 NULL 로 남는다
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- 공모 첨부파일 [{ url, name, size }]. NULL = 없음
ALTER TABLE "Exhibition" ADD COLUMN "attachments" JSONB;

-- 이메일 인증번호(해시만 저장)
CREATE TABLE "EmailCode" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailCode_email_purpose_createdAt_idx" ON "EmailCode"("email", "purpose", "createdAt");
CREATE INDEX "EmailCode_createdAt_idx" ON "EmailCode"("createdAt");
