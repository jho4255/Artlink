-- 아트링크(Admin) 주최 공모 + 운영 갤러리 위임
--
-- hostType: 'GALLERY'(기본, 기존 전부) | 'ADMIN'(아트링크 주최)
-- ExhibitionManager: hostType='ADMIN' 공모에서 운영 권한을 위임받은 갤러리들
ALTER TABLE "Exhibition" ADD COLUMN "hostType" TEXT NOT NULL DEFAULT 'GALLERY';

CREATE TABLE "ExhibitionManager" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "galleryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExhibitionManager_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExhibitionManager_galleryId_idx" ON "ExhibitionManager"("galleryId");
CREATE UNIQUE INDEX "ExhibitionManager_exhibitionId_galleryId_key" ON "ExhibitionManager"("exhibitionId", "galleryId");

ALTER TABLE "ExhibitionManager" ADD CONSTRAINT "ExhibitionManager_exhibitionId_fkey"
    FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExhibitionManager" ADD CONSTRAINT "ExhibitionManager_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
