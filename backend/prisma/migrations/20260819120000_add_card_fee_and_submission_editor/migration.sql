-- 카드 결제 수수료율 + 작가 자료 대신 입력자 기록
--
-- ① Exhibition.cardFeeRate — 카드로 팔린 작품 합계에서 먼저 떼는 수수료율(%).
--    기본값 0 이라 기존 전시의 정산 금액은 **1원도 바뀌지 않는다**.
--    (계산식과 지문은 rate=0 일 때 예전과 완전히 같은 결과를 내도록 짜여 있다 —
--     그렇지 않으면 이미 작가가 수락한 정산이 전부 '변경됨'으로 풀린다)
--
-- ② ExhibitionSubmission.updatedById — 그 자료를 마지막으로 저장한 사람.
--    NULL 이면 알 수 없음(이 마이그레이션 이전에 쓰인 자료 = 전부 작가 본인이 쓴 것).
--    작가 본인이 저장하면 자기 id 가 들어가고, 갤러리/Admin 이 대신 입력하면 그 사람 id 가 들어간다.
--    사용자가 지워지면 기록만 NULL 로 남기고 자료 자체는 보존한다(ON DELETE SET NULL).

ALTER TABLE "Exhibition" ADD COLUMN "cardFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "ExhibitionSubmission" ADD COLUMN "updatedById" INTEGER;

ALTER TABLE "ExhibitionSubmission"
  ADD CONSTRAINT "ExhibitionSubmission_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
