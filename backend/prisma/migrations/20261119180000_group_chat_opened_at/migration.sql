-- 단톡(공모방)은 운영자의 첫 메시지 뒤에 작가에게 보인다(2026-11-19).
ALTER TABLE "Chat" ADD COLUMN "openedAt" TIMESTAMP(3);

-- 이미 말이 오간 단톡은 그대로 보이게 — 첫 메시지 시각으로 채운다(보낸 사람과 무관). 말이 없는 단톡은 null(운영자가 첫 말을 보내면 열린다)
UPDATE "Chat" c
SET "openedAt" = m.first_at
FROM (SELECT "chatId", MIN("createdAt") AS first_at FROM "ChatMessage" GROUP BY "chatId") m
WHERE c.id = m."chatId" AND c.kind = 'GROUP';
