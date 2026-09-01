-- 이웃(Follow) + 스토리(Story)
CREATE TABLE "Follow" (
  "id" SERIAL NOT NULL,
  "followerId" INTEGER NOT NULL,
  "followingId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Story" (
  "id" SERIAL NOT NULL,
  "authorId" INTEGER NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "visibility" TEXT NOT NULL DEFAULT 'NEIGHBORS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Story_authorId_createdAt_idx" ON "Story"("authorId", "createdAt");
CREATE INDEX "Story_createdAt_idx" ON "Story"("createdAt");
ALTER TABLE "Story" ADD CONSTRAINT "Story_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
