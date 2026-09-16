-- 갤러리 페이지 '함께한 작가'에서 숨긴 작가 id 목록 (2026-09-16)
ALTER TABLE "Gallery" ADD COLUMN "hiddenArtistIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
