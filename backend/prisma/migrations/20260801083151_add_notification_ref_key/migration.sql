-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "refKey" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_refKey_idx" ON "Notification"("userId", "refKey");
