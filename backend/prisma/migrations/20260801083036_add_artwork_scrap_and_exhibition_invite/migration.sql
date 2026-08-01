-- CreateTable
CREATE TABLE "ArtworkScrap" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "imageId" INTEGER NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtworkScrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExhibitionInvite" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExhibitionInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtworkScrap_userId_idx" ON "ArtworkScrap"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkScrap_userId_imageId_key" ON "ArtworkScrap"("userId", "imageId");

-- CreateIndex
CREATE INDEX "ExhibitionInvite_artistId_status_idx" ON "ExhibitionInvite"("artistId", "status");

-- CreateIndex
CREATE INDEX "ExhibitionInvite_exhibitionId_idx" ON "ExhibitionInvite"("exhibitionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExhibitionInvite_exhibitionId_artistId_key" ON "ExhibitionInvite"("exhibitionId", "artistId");

-- AddForeignKey
ALTER TABLE "ArtworkScrap" ADD CONSTRAINT "ArtworkScrap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkScrap" ADD CONSTRAINT "ArtworkScrap_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "PortfolioImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionInvite" ADD CONSTRAINT "ExhibitionInvite_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionInvite" ADD CONSTRAINT "ExhibitionInvite_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionInvite" ADD CONSTRAINT "ExhibitionInvite_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
