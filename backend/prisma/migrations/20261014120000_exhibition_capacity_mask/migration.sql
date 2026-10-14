-- 모집 인원을 공고에 '0명'(한 자릿수)·'00명'(두 자릿수)으로만 적기(2026-10-14). NULL = 숫자 그대로(기존 공모 전부)
-- 수락 한도는 그대로 "capacity" 가 정한다(0명 = 9, 00명 = 99 — backend/src/lib/capacity.ts)
ALTER TABLE "Exhibition" ADD COLUMN "capacityMask" TEXT;
