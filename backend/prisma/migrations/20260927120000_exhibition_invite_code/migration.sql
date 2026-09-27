-- 초대 코드(공모당 하나, 행이 없으면 끔) + 지원이 어떻게 들어왔는지(null = 지원서, INVITE, CODE) — 2026-09-27
-- ⚠️ 코드를 Exhibition 컬럼에 두지 않는다: 공모 상세·목록이 행을 통째로 내려줘 공개 응답에 코드가 실린다(schema.prisma 주석)
-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "joinedVia" TEXT;

-- CreateTable
CREATE TABLE "ExhibitionJoinCode" (
    "exhibitionId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExhibitionJoinCode_pkey" PRIMARY KEY ("exhibitionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExhibitionJoinCode_code_key" ON "ExhibitionJoinCode"("code");

-- AddForeignKey
ALTER TABLE "ExhibitionJoinCode" ADD CONSTRAINT "ExhibitionJoinCode_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

