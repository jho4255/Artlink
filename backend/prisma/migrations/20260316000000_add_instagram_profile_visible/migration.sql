-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN "instagramProfileVisible" BOOLEAN NOT NULL DEFAULT false;

-- 기존 데이터: instagramUrl이 있던 갤러리는 이미 공개 상태였으므로 true로 초기화
UPDATE "Gallery" SET "instagramProfileVisible" = true WHERE "instagramUrl" IS NOT NULL;
