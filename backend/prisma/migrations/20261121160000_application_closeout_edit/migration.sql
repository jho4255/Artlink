-- 모집 마감 때 남은 검토 대기는 미선정 · 작가의 지원서 수정 (2026-11-21, CLAUDE.md 규칙 90)

ALTER TABLE "Application" ADD COLUMN "closedOutAt" TIMESTAMP(3);
ALTER TABLE "Application" ADD COLUMN "editedAt" TIMESTAMP(3);

-- 선정이 이미 끝난 공모(전시를 확정했거나 · 전시가 시작됐거나 · 끝난)에 남은 검토 대기 → 미선정. 작가에게 알림은 보내지 않는다
-- (사용자 결정 — 작가 화면에서 미선정으로 보이면 된다). 전시 확정·종료가 선정의 끝이라는 규칙(규칙 90)을 이미 그 단계를 지난 공모에도 맞춘다.
-- ⚠️ 모집만 마감한 공모는 건드리지 않는다 — 아직 고르는 중일 수 있고, 미선정이 되면 다시 수락할 수 없다(이미 올라간 공고는 그대로 둔다).
-- updatedAt 은 건드리지 않는다 — 그 값은 '결정한 때' 로 읽힌다(관리자 통계 운영 속도). 통계는 closedOutAt 이 있는 행을 결정으로 세지 않는다.
UPDATE "Application" a
SET "status" = 'REJECTED', "closedOutAt" = NOW()
FROM "Exhibition" e
WHERE a."exhibitionId" = e."id"
  AND a."status" IN ('SUBMITTED', 'REVIEWED')
  AND (e."confirmed" = true OR e."ended" = true OR (e."exhibitStartDate" IS NOT NULL AND e."exhibitStartDate" <= NOW()));
