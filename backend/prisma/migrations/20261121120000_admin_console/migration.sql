-- 관리자 화면 개편(2026-11-21): 승인·거절한 때 + 공모 첨부파일 받은 수

ALTER TABLE "Gallery" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Exhibition" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Show" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRequest" ADD COLUMN "decidedAt" TIMESTAMP(3);

CREATE TABLE "ExhibitionAttachmentHit" (
    "exhibitionId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ExhibitionAttachmentHit_pkey" PRIMARY KEY ("exhibitionId","day")
);
CREATE INDEX "ExhibitionAttachmentHit_day_idx" ON "ExhibitionAttachmentHit"("day");
ALTER TABLE "ExhibitionAttachmentHit" ADD CONSTRAINT "ExhibitionAttachmentHit_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 지난 결정 시각 채우기 — 처리된 요청은 마지막으로 바뀐 때(처리 뒤엔 고치지 않는다)
UPDATE "ApprovalRequest" SET "decidedAt" = "updatedAt" WHERE "status" <> 'PENDING';

-- 갤러리·공모·전시는 updatedAt 이 다른 수정에도 바뀌어 믿을 수 없다 — 그때 보낸 승인 결과 알림의 시각을 쓴다(없으면 null)
UPDATE "Gallery" g SET "reviewedAt" = n.t
FROM (SELECT substring("linkUrl" from '^/galleries/([0-9]+)$')::int AS id, max("createdAt") AS t
      FROM "Notification" WHERE "type" = 'APPROVAL_RESULT' AND "linkUrl" ~ '^/galleries/[0-9]+$' GROUP BY 1) n
WHERE g."id" = n.id AND g."status" <> 'PENDING';

UPDATE "Exhibition" e SET "reviewedAt" = n.t
FROM (SELECT substring("linkUrl" from '^/exhibitions/([0-9]+)$')::int AS id, max("createdAt") AS t
      FROM "Notification" WHERE "type" = 'APPROVAL_RESULT' AND "linkUrl" ~ '^/exhibitions/[0-9]+$' GROUP BY 1) n
WHERE e."id" = n.id AND e."status" <> 'PENDING' AND e."hostType" = 'GALLERY';

UPDATE "Show" s SET "reviewedAt" = n.t
FROM (SELECT substring("linkUrl" from '^/shows/([0-9]+)$')::int AS id, max("createdAt") AS t
      FROM "Notification" WHERE "type" = 'APPROVAL_RESULT' AND "linkUrl" ~ '^/shows/[0-9]+$' GROUP BY 1) n
WHERE s."id" = n.id AND s."status" <> 'PENDING';
