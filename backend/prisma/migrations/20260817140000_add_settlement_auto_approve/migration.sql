-- 무응답 자동 수락 (3일)
--
-- askedAt        : 이 작가에게 마지막으로 물어본 시각. 기한의 기준점.
-- autoApprovedAt : 무응답으로 자동 수락된 시각. 사람이 누른 수락과 구분하기 위한 것 —
--                  돈 문제라 나중에 "동의한 적 없다"는 다툼이 생기면 이게 유일한 근거다.
--
-- ⚠️ 기존 PENDING 행에 askedAt 을 **채우지 않는다**(NULL 유지 = 자동 수락 대상 아님).
--    이미 요청받은 작가들은 '3일 무응답이면 자동 수락'이라는 안내를 받은 적이 없다.
--    침묵을 동의로 보는 규칙을 경고 없이 소급 적용하면, 작가는 본 적도 없는 규칙으로
--    정산에 동의한 것이 된다. 규칙은 이 배포 **이후에 보낸 요청부터** 적용된다.
--    지금 걸려 있는 건은 갤러리가 [이 작가에게 다시 확인 요청]을 누르면 기한이 시작되고,
--    그때 나가는 알림에 자동 수락 안내가 함께 들어간다.
ALTER TABLE "SettlementApproval" ADD COLUMN "askedAt" TIMESTAMP(3);
ALTER TABLE "SettlementApproval" ADD COLUMN "autoApprovedAt" TIMESTAMP(3);
