-- AlterTable
ALTER TABLE "Exhibition" ADD COLUMN     "deadlineStart" TIMESTAMP(3),
ADD COLUMN     "exhibitStartDate" TIMESTAMP(3),
ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN     "email" TEXT,
ADD COLUMN     "instagramUrl" TEXT;
