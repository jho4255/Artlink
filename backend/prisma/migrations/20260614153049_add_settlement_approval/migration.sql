-- AlterTable
ALTER TABLE "Exhibition" ADD COLUMN     "settlementRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SettlementApproval" (
    "id" SERIAL NOT NULL,
    "exhibitionId" INTEGER NOT NULL,
    "artistUserId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementApproval_exhibitionId_idx" ON "SettlementApproval"("exhibitionId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementApproval_exhibitionId_artistUserId_key" ON "SettlementApproval"("exhibitionId", "artistUserId");

-- AddForeignKey
ALTER TABLE "SettlementApproval" ADD CONSTRAINT "SettlementApproval_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
