-- 배너 슬라이드에 모바일 전용 이미지 칸을 더한다 (없으면 기존 imageUrl 사용)
ALTER TABLE "HeroSlide" ADD COLUMN "mobileImageUrl" TEXT;
