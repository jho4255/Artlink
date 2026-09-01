-- ChatMessage 첨부 (사진/동영상/파일) + 첨부만 있는 메시지 허용(content 기본값)
ALTER TABLE "ChatMessage" ALTER COLUMN "content" SET DEFAULT '';
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentType" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentSize" INTEGER;
