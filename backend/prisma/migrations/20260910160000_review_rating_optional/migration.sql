-- 리뷰에서 별점을 없앤다 (2026-09-10, 사용자 요청)
--
-- ⚠️ 컬럼을 **지우지 않는다**. 그 전에 쓰인 별점은 실제 사용자가 남긴 기록이라,
--    화면에서 안 쓴다고 되돌릴 수 없게 삭제할 이유가 없다. NOT NULL 만 푼다.
--    신규 리뷰는 null 로 들어가고, `Gallery.rating` 은 그 시점 값에서 동결된다
--    (`reviewCount` 는 계속 갱신한다 — 별점과 무관한 '리뷰 개수'다).
ALTER TABLE "Review" ALTER COLUMN "rating" DROP NOT NULL;
