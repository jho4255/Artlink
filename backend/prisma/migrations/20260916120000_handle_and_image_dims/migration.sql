-- 작가 홈페이지 주소(/@handle) + 작품 사진 픽셀 크기 (2026-09-16)
ALTER TABLE "User" ADD COLUMN "handle" TEXT;
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

ALTER TABLE "PortfolioImage" ADD COLUMN "width" INTEGER;
ALTER TABLE "PortfolioImage" ADD COLUMN "height" INTEGER;
