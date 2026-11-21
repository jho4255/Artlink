-- 선정 마감일 (2026-11-21, CLAUDE.md 규칙 90) — 새로 올리는 공고부터 받는다. 이미 올라간 공고는 null 로 둔다(사용자 결정).
ALTER TABLE "Exhibition" ADD COLUMN "selectionDeadline" TIMESTAMP(3);
