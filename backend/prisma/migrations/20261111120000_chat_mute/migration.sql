-- 대화방 알림 끄기(2026-11-11) — 참여자별. 기본은 켜짐(false).
ALTER TABLE "ChatParticipant" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;
