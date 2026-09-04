-- 탭별 쓰기 제한 — 켜면 Admin 만 그 탭에 글을 쓸 수 있다(공지 탭 등). 읽기는 그대로 공개.
-- 기존 탭은 전부 false(누구나 쓰기) — 동작이 안 바뀐다.
ALTER TABLE "PostCategory" ADD COLUMN "writeAdminOnly" BOOLEAN NOT NULL DEFAULT false;
