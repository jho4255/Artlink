-- 기존 승인행에 정산 지문을 채운다.
--
-- 이걸 안 하면 **이미 운영 중인 정산이 깨진다**. 앞 마이그레이션이 추가한 snapshot 이 NULL 이라
-- 지문 대조가 전부 불일치로 나오기 때문이다. 실측:
--   · 전원 수락한 공모에서 [정산 완료] → 400 "작가 확인 이후 정산 내용이 바뀐 작가가 N명"
--   · 내용을 안 바꾸고 저장만 해도 수락이 전부 풀리고 작가들에게 헛알림이 나감
--
-- 지금 저장된 판매·비율로 지문을 만든다. 옛 코드에서는 확인 요청 중 수정이 403 으로 막혀 있었고
-- 요청 취소는 승인행을 통째로 지웠으므로, **승인이 남아 있다 = 그 뒤로 금액이 안 바뀌었다** 가 성립한다.
-- (예외는 관리자 직접 수정뿐인데, 그건 옛 동작을 그대로 두는 것이라 더 나빠지지 않는다)
--
-- 문자열 규칙은 backend/src/lib/settlementFingerprint.ts 와 **바이트 단위로 같아야 한다**:
--   r{갤러리비율}|{작품index}:{판매가}:{CARD|CASH},...   ← index 오름차순, 판매 없으면 'r0|'
-- 다르면 조용히 전부 불일치가 되어 위 증상이 그대로 재현된다.
--
-- PENDING 은 채우지 않는다 — 아직 응답하지 않은 사람이고, 응답할 때 서버가 직접 써 넣는다.
UPDATE "SettlementApproval" sa
SET "snapshot" =
  'r'
  || COALESCE((
       SELECT s."galleryRatio"
       FROM "ArtistSettlement" s
       WHERE s."exhibitionId" = sa."exhibitionId" AND s."artistUserId" = sa."artistUserId"
     ), 0)::text
  || '|'
  || COALESCE((
       SELECT string_agg(
                w."artworkIndex"::text || ':' || w."soldPrice"::text || ':'
                  || (CASE WHEN w."paymentMethod" = 'CASH' THEN 'CASH' ELSE 'CARD' END),
                ',' ORDER BY w."artworkIndex"
              )
       FROM "ArtworkSale" w
       WHERE w."exhibitionId" = sa."exhibitionId" AND w."artistUserId" = sa."artistUserId"
     ), '')
WHERE sa."snapshot" IS NULL AND sa."status" <> 'PENDING';
