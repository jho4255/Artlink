-- 포트폴리오 PDF 버전 — 작품 선택·순서·디자인을 이름 붙여 여러 개 저장 (2026-09-16)
CREATE TABLE "PortfolioVersion" (
  "id"          SERIAL NOT NULL,
  "portfolioId" INTEGER NOT NULL,
  "name"        TEXT NOT NULL,
  "workIds"     INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "design"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortfolioVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PortfolioVersion_portfolioId_idx" ON "PortfolioVersion"("portfolioId");
ALTER TABLE "PortfolioVersion" ADD CONSTRAINT "PortfolioVersion_portfolioId_fkey"
  FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
