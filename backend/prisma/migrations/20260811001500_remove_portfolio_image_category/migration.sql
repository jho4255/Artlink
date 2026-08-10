-- 전시 전경(INSTALL) 기능 철회 — 작품/전시전경 구분을 두지 않기로 함.
-- 이 컬럼은 같은 날 추가됐고 배포된 적이 없다.
ALTER TABLE "PortfolioImage" DROP COLUMN "category";
