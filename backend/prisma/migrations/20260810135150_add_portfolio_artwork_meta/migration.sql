-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "seriesInfo" TEXT,
ADD COLUMN     "statement" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "themeId" TEXT;

-- AlterTable
ALTER TABLE "PortfolioImage" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'WORK',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "medium" TEXT,
ADD COLUMN     "series" TEXT,
ADD COLUMN     "sizeText" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "year" TEXT;
