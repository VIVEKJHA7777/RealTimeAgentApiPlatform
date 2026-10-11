-- DropForeignKey
ALTER TABLE "records" DROP CONSTRAINT "records_organization_id_fkey";

-- DropIndex
DROP INDEX "records_organization_id_idx";
