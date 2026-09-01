-- 작가 홈페이지 가이드형 디자인 설정(JSON): { theme, works, sections:[{id,enabled}] }. null=기본(현재 모습)
ALTER TABLE "Portfolio" ADD COLUMN "designConfig" TEXT;
