-- 히어로 배너 사진 위 글자 색 고정(2026-10-05). NULL = 자동(그 자리 밝기로 검정/흰색), 'black' · 'white' = 관리자가 고정
ALTER TABLE "HeroSlide" ADD COLUMN "textTone" TEXT;
