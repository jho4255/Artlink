-- CreateTable
CREATE TABLE "ExhibitionImage" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "exhibitionId" INTEGER NOT NULL,

    CONSTRAINT "ExhibitionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExhibitionImage_exhibitionId_idx" ON "ExhibitionImage"("exhibitionId");

-- AddForeignKey
ALTER TABLE "ExhibitionImage" ADD CONSTRAINT "ExhibitionImage_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
