/*
  Warnings:

  - You are about to drop the column `highlighted` on the `Post` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Post" DROP COLUMN "highlighted";

-- CreateTable
CREATE TABLE "StoryHighlight" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "storyIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryHighlight_userId_order_idx" ON "StoryHighlight"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "StoryHighlight_userId_name_key" ON "StoryHighlight"("userId", "name");

-- AddForeignKey
ALTER TABLE "StoryHighlight" ADD CONSTRAINT "StoryHighlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
