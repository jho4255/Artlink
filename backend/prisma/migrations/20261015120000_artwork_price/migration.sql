-- 작품 가격(2026-10-15) — 작가가 원할 때만. 가격은 별도 표에 둔다(작품 행을 통째로 내려주는 공개 응답에 실리지 않게).
-- 홈페이지 노출은 "Portfolio"."showPrice"(기본 꺼짐), PDF 노출은 designConfig.showPrice 가 따로 정한다.
ALTER TABLE "Portfolio" ADD COLUMN "showPrice" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ArtworkPrice" (
    "imageId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkPrice_pkey" PRIMARY KEY ("imageId")
);

ALTER TABLE "ArtworkPrice" ADD CONSTRAINT "ArtworkPrice_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "PortfolioImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
