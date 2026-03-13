-- CreateTable
CREATE TABLE "Show" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "openingHours" TEXT NOT NULL,
    "admissionFee" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "artists" TEXT,
    "posterImage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "galleryId" INTEGER NOT NULL,
    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowImage" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "showId" INTEGER NOT NULL,
    CONSTRAINT "ShowImage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Favorite" ADD COLUMN "showId" INTEGER;

-- CreateIndex
CREATE INDEX "Show_galleryId_idx" ON "Show"("galleryId");
CREATE INDEX "Show_status_region_idx" ON "Show"("status", "region");
CREATE UNIQUE INDEX "Favorite_userId_showId_key" ON "Favorite"("userId", "showId");

-- AddForeignKey
ALTER TABLE "Show" ADD CONSTRAINT "Show_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowImage" ADD CONSTRAINT "ShowImage_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;
