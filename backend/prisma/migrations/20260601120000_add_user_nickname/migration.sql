-- AlterTable
ALTER TABLE "User" ADD COLUMN "nickname" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");
