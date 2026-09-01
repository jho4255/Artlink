-- 방명록 (작가 홈페이지)
CREATE TABLE "GuestbookEntry" (
  "id" SERIAL NOT NULL,
  "targetUserId" INTEGER NOT NULL,
  "authorId" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "secret" BOOLEAN NOT NULL DEFAULT false,
  "parentId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestbookEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GuestbookEntry_targetUserId_createdAt_idx" ON "GuestbookEntry"("targetUserId", "createdAt");
ALTER TABLE "GuestbookEntry" ADD CONSTRAINT "GuestbookEntry_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestbookEntry" ADD CONSTRAINT "GuestbookEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestbookEntry" ADD CONSTRAINT "GuestbookEntry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GuestbookEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
