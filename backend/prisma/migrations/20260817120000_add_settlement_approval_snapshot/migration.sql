-- 정산 재확인 범위를 '전원'에서 '금액이 바뀐 작가'로 좁히기 위한 지문 컬럼.
-- 응답 시점의 판매·비율을 문자열로 남겨두고 저장할 때마다 대조한다(lib/settlementFingerprint.ts).
-- nullable — 기존 행은 지문이 없어 첫 저장 때 한 번 재확인 대상이 된다(수락을 잘못 유지하는 것보다 안전).
ALTER TABLE "SettlementApproval" ADD COLUMN "snapshot" TEXT;
