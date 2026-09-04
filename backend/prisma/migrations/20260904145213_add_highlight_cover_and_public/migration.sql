/*
  Warnings:

  - Added the required column `updatedAt` to the `StoryHighlight` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StoryHighlight" ADD COLUMN     "coverStoryId" INTEGER,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
