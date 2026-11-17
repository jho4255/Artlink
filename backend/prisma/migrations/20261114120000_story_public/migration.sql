-- ArtStory 홈 공개 (2026-11-14, CLAUDE.md 규칙 81)
-- 전체공개 소식을 홈 ArtStory 줄에서 누구나 본다. 기본 공개범위를 PUBLIC 으로 — 이미 있는 소식의 값은 바꾸지 않는다.
-- 글만 소식의 바탕색 · 운영/신고로 내리기 · 신고 · 그만 보기.

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "bg" TEXT,
ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "StoryReport" (
    "id" SERIAL NOT NULL,
    "storyId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryMute" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "mutedUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryReport_createdAt_idx" ON "StoryReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoryReport_storyId_reporterId_key" ON "StoryReport"("storyId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryMute_userId_mutedUserId_key" ON "StoryMute"("userId", "mutedUserId");

-- CreateIndex
CREATE INDEX "Story_visibility_createdAt_idx" ON "Story"("visibility", "createdAt");

-- AddForeignKey
ALTER TABLE "StoryReport" ADD CONSTRAINT "StoryReport_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryReport" ADD CONSTRAINT "StoryReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryMute" ADD CONSTRAINT "StoryMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryMute" ADD CONSTRAINT "StoryMute_mutedUserId_fkey" FOREIGN KEY ("mutedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

