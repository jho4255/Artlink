-- CreateTable
CREATE TABLE "KanbanSubtask" (
    "id" SERIAL NOT NULL,
    "cardId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanSubtask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KanbanSubtask_cardId_position_idx" ON "KanbanSubtask"("cardId", "position");

-- AddForeignKey
ALTER TABLE "KanbanSubtask" ADD CONSTRAINT "KanbanSubtask_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
