-- 커뮤니티 탭(말머리) + 공지글 + 고정 — 전부 Admin 전용 기능
-- ⚠️ 기존 글은 categoryId = NULL('미분류')로 남는다. 데이터 손실 없음.

CREATE TABLE "PostCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostCategory_name_key" ON "PostCategory"("name");
CREATE UNIQUE INDEX "PostCategory_slug_key" ON "PostCategory"("slug");
CREATE INDEX "PostCategory_order_idx" ON "PostCategory"("order");

ALTER TABLE "Post" ADD COLUMN "categoryId" INTEGER;
ALTER TABLE "Post" ADD COLUMN "notice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Post" ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "Post_categoryId_idx" ON "Post"("categoryId");
CREATE INDEX "Post_pinnedAt_idx" ON "Post"("pinnedAt");

-- 탭을 지워도 글은 남는다 — 미분류로 내려온다
ALTER TABLE "Post" ADD CONSTRAINT "Post_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "PostCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
