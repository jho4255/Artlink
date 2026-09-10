-- 공모 두 가지 변경 (2026-09-10)
--
-- 1) 주관 갤러리를 선택값으로 — 아트링크(Admin) 주최 공모는 갤러리를 아예 안 끼고 열 수 있다.
--    기존 행은 전부 값이 있으므로 NOT NULL 을 푸는 것만으로 안전하다(데이터 이동 없음).
-- 2) `recruitOnly` — 공모만 진행(수락까지)하고 자료제출·전시·정산 단계를 안 쓰는 공고.
--    기본값 false 라 기존 공모의 동작은 그대로다.

ALTER TABLE "Exhibition" ALTER COLUMN "galleryId" DROP NOT NULL;

ALTER TABLE "Exhibition" ADD COLUMN "recruitOnly" BOOLEAN NOT NULL DEFAULT false;
