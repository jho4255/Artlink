ALTER TABLE "Application"
ADD COLUMN "termsAgreedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT,
ADD COLUMN "termsTextHash" TEXT;
