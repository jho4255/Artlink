-- 커뮤니티 글쓰기 개편 (2026-11-13, CLAUDE.md 규칙 80) — 블로그형 편집기(글 문서) · 탭별 쓰기 권한/모양/익명 · 작업본 · 글 사진·동영상 기록 · 필진
--   · 목록 요약(excerpt) · 투표(poll + PostPollVote) · 대댓글(parentId/replyToId/deletedAt). 표지는 따로 없다(첫 사진).
-- ⚠️ 칼럼을 지우지 않는다(옛 서버가 배포 중 잠깐 같이 돈다 — writeAdminOnly 는 writePolicy 와 함께 유지한다).

-- AlterTable
ALTER TABLE "PostCategory" ADD COLUMN     "allowAnonymous" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "layout" TEXT NOT NULL DEFAULT 'list',
ADD COLUMN     "writePolicy" TEXT NOT NULL DEFAULT 'all';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "doc" JSONB,
ADD COLUMN     "docVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "excerpt" TEXT,
ADD COLUMN     "poll" JSONB,
ADD COLUMN     "videos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PostComment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "parentId" INTEGER,
ADD COLUMN     "replyToId" INTEGER;

-- CreateTable
CREATE TABLE "PostDraft" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "postId" INTEGER,
    "categoryId" INTEGER,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT '',
    "doc" JSONB NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rev" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostAsset" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityWriter" (
    "userId" INTEGER NOT NULL,
    "addedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityWriter_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PostPollVote" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostDraft_postId_key" ON "PostDraft"("postId");

-- CreateIndex
CREATE INDEX "PostDraft_authorId_updatedAt_idx" ON "PostDraft"("authorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostAsset_url_key" ON "PostAsset"("url");

-- CreateIndex
CREATE INDEX "PostAsset_userId_createdAt_idx" ON "PostAsset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PostAsset_createdAt_idx" ON "PostAsset"("createdAt");

-- CreateIndex
CREATE INDEX "PostPollVote_postId_optionId_idx" ON "PostPollVote"("postId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "PostPollVote_postId_userId_optionId_key" ON "PostPollVote"("postId", "userId", "optionId");

-- CreateIndex
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");

-- CreateIndex
CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId");

-- AddForeignKey
ALTER TABLE "PostDraft" ADD CONSTRAINT "PostDraft_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDraft" ADD CONSTRAINT "PostDraft_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDraft" ADD CONSTRAINT "PostDraft_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PostCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAsset" ADD CONSTRAINT "PostAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityWriter" ADD CONSTRAINT "CommunityWriter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "PostComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPollVote" ADD CONSTRAINT "PostPollVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPollVote" ADD CONSTRAINT "PostPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 데이터: 관리자만 쓰던 탭은 그대로 관리자만
UPDATE "PostCategory" SET "writePolicy" = 'admin' WHERE "writeAdminOnly" = true;
