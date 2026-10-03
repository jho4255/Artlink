-- 포트폴리오 PDF 저장 기록 (2026-10-03) — Admin [통계] 탭의 '포트폴리오 PDF 저장'
-- CreateTable
CREATE TABLE "PortfolioExport" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "userId" INTEGER,
    "method" TEXT NOT NULL,
    "pages" INTEGER NOT NULL,
    "works" INTEGER NOT NULL,
    "uploaded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioExport_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "PortfolioExport_day_idx" ON "PortfolioExport"("day");
-- CreateIndex
CREATE INDEX "PortfolioExport_userId_day_idx" ON "PortfolioExport"("userId", "day");
-- AddForeignKey
ALTER TABLE "PortfolioExport" ADD CONSTRAINT "PortfolioExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
