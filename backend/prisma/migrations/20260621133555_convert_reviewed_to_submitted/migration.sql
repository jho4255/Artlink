-- 지원 상태에서 '검토중(REVIEWED)' 제거: 기존 REVIEWED 지원은 '접수(SUBMITTED)'로 환원
UPDATE "Application" SET "status" = 'SUBMITTED' WHERE "status" = 'REVIEWED';
