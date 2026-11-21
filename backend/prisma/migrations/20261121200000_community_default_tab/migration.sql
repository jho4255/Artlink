-- 커뮤니티 '탭 없음'을 없앤다 — 기본 탭(자유게시판) (2026-11-21, CLAUDE.md 규칙 80)
-- 사용자: "탭 없음은 할 수 없게 하고 그런 건 자유게시판으로 하면 되는 거잖아. 탭 없음이란 건 없애."

ALTER TABLE "PostCategory" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- 자유게시판이 없으면 만든다(실서버엔 있다 — 그대로 기본 탭이 된다)
INSERT INTO "PostCategory" ("name", "slug", "order", "active", "writeAdminOnly", "writePolicy", "layout", "allowAnonymous")
SELECT '자유게시판',
       CASE WHEN EXISTS (SELECT 1 FROM "PostCategory" WHERE "slug" = 'free') THEN 'free-board' ELSE 'free' END,
       COALESCE((SELECT MAX("order") FROM "PostCategory"), 0) + 1, true, false, 'all', 'list', true
WHERE NOT EXISTS (SELECT 1 FROM "PostCategory" WHERE "name" = '자유게시판');

UPDATE "PostCategory" SET "isDefault" = true WHERE "name" = '자유게시판';

-- 탭이 없던 글·쓰던 글은 자유게시판으로
UPDATE "Post" SET "categoryId" = (SELECT "id" FROM "PostCategory" WHERE "isDefault" ORDER BY "id" LIMIT 1) WHERE "categoryId" IS NULL;
UPDATE "PostDraft" SET "categoryId" = (SELECT "id" FROM "PostCategory" WHERE "isDefault" ORDER BY "id" LIMIT 1) WHERE "categoryId" IS NULL;
