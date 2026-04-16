-- AlterTable
ALTER TABLE "PortfolioImage" ADD COLUMN     "showInExplore" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PortfolioImageLike" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "imageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioImageLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioImageLike_imageId_idx" ON "PortfolioImageLike"("imageId");

-- CreateIndex
CREATE INDEX "PortfolioImageLike_userId_idx" ON "PortfolioImageLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioImageLike_userId_imageId_key" ON "PortfolioImageLike"("userId", "imageId");

-- AddForeignKey
ALTER TABLE "PortfolioImageLike" ADD CONSTRAINT "PortfolioImageLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioImageLike" ADD CONSTRAINT "PortfolioImageLike_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "PortfolioImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
