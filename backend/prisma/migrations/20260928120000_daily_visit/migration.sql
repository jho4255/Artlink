-- CreateTable
CREATE TABLE "DailyVisit" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyVisit_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "DailyVisit_day_idx" ON "DailyVisit"("day");
-- CreateIndex
CREATE UNIQUE INDEX "DailyVisit_day_visitorId_key" ON "DailyVisit"("day", "visitorId");
-- AddForeignKey
ALTER TABLE "DailyVisit" ADD CONSTRAINT "DailyVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
