-- 포트폴리오/지원서 고정 양식: 경력(JSON), 작품사진, 포트폴리오 파일 컬럼 추가
-- (기존 exhibitionHistory / customAnswers 컬럼은 하위호환 위해 유지)

ALTER TABLE "Portfolio" ADD COLUMN "career" TEXT;
ALTER TABLE "Portfolio" ADD COLUMN "portfolioFileUrl" TEXT;

ALTER TABLE "Application" ADD COLUMN "biography" TEXT;
ALTER TABLE "Application" ADD COLUMN "career" TEXT;
ALTER TABLE "Application" ADD COLUMN "artworkImages" TEXT;
ALTER TABLE "Application" ADD COLUMN "portfolioFileUrl" TEXT;
