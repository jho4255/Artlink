-- 갤러리 홈페이지 주소(/@handle) + 갤러리가 직접 적는 지난 활동 기록 (2026-09-16)
ALTER TABLE "Gallery" ADD COLUMN "handle" TEXT;
CREATE UNIQUE INDEX "Gallery_handle_key" ON "Gallery"("handle");

CREATE TABLE "GalleryArchive" (
  "id"        SERIAL NOT NULL,
  "galleryId" INTEGER NOT NULL,
  "title"     TEXT NOT NULL,
  "venue"     TEXT,
  "period"    TEXT,
  "date"      TIMESTAMP(3),
  "artists"   TEXT,
  "body"      TEXT,
  "images"    TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GalleryArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GalleryArchive_galleryId_date_idx" ON "GalleryArchive"("galleryId", "date");
ALTER TABLE "GalleryArchive" ADD CONSTRAINT "GalleryArchive_galleryId_fkey"
  FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
