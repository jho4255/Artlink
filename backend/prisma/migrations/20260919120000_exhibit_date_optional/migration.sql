-- 공모만 진행(recruitOnly)하는 공고에는 전시가 없다 — 전시 종료일을 요구하지 않는다 (2026-09-19)
ALTER TABLE "Exhibition" ALTER COLUMN "exhibitDate" DROP NOT NULL;
