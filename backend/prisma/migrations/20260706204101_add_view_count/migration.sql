-- 상세 페이지 조회수 (Admin 통계용). 기존 레코드는 기본값 0으로 채워짐.
ALTER TABLE "Gallery" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Exhibition" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Show" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
