-- 비회원 작가 (2026-11-23, CLAUDE.md 규칙 91) — 공모 운영자가 가입하지 않은 작가를 직접 넣는다.
-- 작가 한 명 = 로그인할 수 없는 계정(User.role 'GUEST') 하나 + 이 연결 행 하나. 지원(Application)이 아니다.
CREATE TABLE "ExhibitionGuestArtist" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExhibitionGuestArtist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExhibitionGuestArtist_userId_key" ON "ExhibitionGuestArtist"("userId");
CREATE INDEX "ExhibitionGuestArtist_exhibitionId_idx" ON "ExhibitionGuestArtist"("exhibitionId");

ALTER TABLE "ExhibitionGuestArtist" ADD CONSTRAINT "ExhibitionGuestArtist_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExhibitionGuestArtist" ADD CONSTRAINT "ExhibitionGuestArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExhibitionGuestArtist" ADD CONSTRAINT "ExhibitionGuestArtist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
