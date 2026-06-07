-- 공모 상태(모집마감/확정/종료) + 정산(판매작/작가별 비율)

ALTER TABLE "Exhibition" ADD COLUMN "recruitmentClosed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Exhibition" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Exhibition" ADD COLUMN "ended" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ArtworkSale" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "artistUserId" INTEGER NOT NULL,
    "artworkIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "soldPrice" INTEGER NOT NULL,
    CONSTRAINT "ArtworkSale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ArtworkSale_exhibitionId_artistUserId_artworkIndex_key" ON "ArtworkSale"("exhibitionId", "artistUserId", "artworkIndex");
CREATE INDEX "ArtworkSale_exhibitionId_idx" ON "ArtworkSale"("exhibitionId");
ALTER TABLE "ArtworkSale" ADD CONSTRAINT "ArtworkSale_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ArtistSettlement" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "artistUserId" INTEGER NOT NULL,
    "galleryRatio" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ArtistSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ArtistSettlement_exhibitionId_artistUserId_key" ON "ArtistSettlement"("exhibitionId", "artistUserId");
CREATE INDEX "ArtistSettlement_exhibitionId_idx" ON "ArtistSettlement"("exhibitionId");
ALTER TABLE "ArtistSettlement" ADD CONSTRAINT "ArtistSettlement_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
