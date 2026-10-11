-- AlterTable
ALTER TABLE "apis" ADD COLUMN     "design" JSONB,
ADD COLUMN     "design_version" INTEGER NOT NULL DEFAULT 0;
