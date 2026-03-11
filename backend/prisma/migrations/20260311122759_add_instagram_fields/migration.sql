-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN     "instagramAccessToken" TEXT,
ADD COLUMN     "instagramFeedVisible" BOOLEAN NOT NULL DEFAULT false;
