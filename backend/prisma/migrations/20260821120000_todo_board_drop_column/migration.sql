-- 3열 칸반 → 목록형 체크리스트.
-- 열(column) 개념이 사라졌다. 완료 여부는 doneAt 하나로만 판정한다.
-- 남아 있던 값은 전부 기본값 'TODO'(= 아직 안 한 일)라 버려도 잃는 정보가 없다.
DROP INDEX "KanbanCard_boardId_column_position_idx";
ALTER TABLE "KanbanCard" DROP COLUMN "column";
CREATE INDEX "KanbanCard_boardId_position_idx" ON "KanbanCard"("boardId", "position");
