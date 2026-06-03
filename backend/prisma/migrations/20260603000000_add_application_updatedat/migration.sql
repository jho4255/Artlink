-- AlterTable: 기존 행은 현재 시각으로 채움(NOT NULL), 이후 @updatedAt가 자동 갱신
ALTER TABLE "Application" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
