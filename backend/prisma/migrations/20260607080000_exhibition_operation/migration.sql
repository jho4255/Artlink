-- 공모 운영 페이지: 공지사항 + 작가 제출 정보(출품리스트/약력/노트)

CREATE TABLE "ExhibitionNotice" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExhibitionNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExhibitionNotice_exhibitionId_idx" ON "ExhibitionNotice"("exhibitionId");

ALTER TABLE "ExhibitionNotice" ADD CONSTRAINT "ExhibitionNotice_exhibitionId_fkey"
    FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExhibitionSubmission" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "artworkList" TEXT,
    "cv" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExhibitionSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExhibitionSubmission_exhibitionId_userId_key" ON "ExhibitionSubmission"("exhibitionId", "userId");
CREATE INDEX "ExhibitionSubmission_exhibitionId_idx" ON "ExhibitionSubmission"("exhibitionId");

ALTER TABLE "ExhibitionSubmission" ADD CONSTRAINT "ExhibitionSubmission_exhibitionId_fkey"
    FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExhibitionSubmission" ADD CONSTRAINT "ExhibitionSubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
