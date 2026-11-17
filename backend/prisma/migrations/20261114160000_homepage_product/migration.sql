-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN     "guestInquiry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openHours" TEXT;

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "guestInquiry" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "HomepageInquiry" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "galleryId" INTEGER,
    "imageId" INTEGER,
    "workTitle" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "HomepageInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomepageInquiry_ownerId_createdAt_idx" ON "HomepageInquiry"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "HomepageInquiry_createdAt_idx" ON "HomepageInquiry"("createdAt");

-- AddForeignKey
ALTER TABLE "HomepageInquiry" ADD CONSTRAINT "HomepageInquiry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageInquiry" ADD CONSTRAINT "HomepageInquiry_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

