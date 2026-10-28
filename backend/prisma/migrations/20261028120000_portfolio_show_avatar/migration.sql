-- 홈페이지 이름 위에 프로필 사진 보이기(2026-10-28, 기본 꺼짐)
ALTER TABLE "Portfolio" ADD COLUMN "showAvatar" BOOLEAN NOT NULL DEFAULT false;
