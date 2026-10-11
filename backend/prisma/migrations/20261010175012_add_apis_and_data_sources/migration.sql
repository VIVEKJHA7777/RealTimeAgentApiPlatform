-- CreateEnum
CREATE TYPE "feed_type" AS ENUM ('product', 'review', 'store', 'content');

-- CreateEnum
CREATE TYPE "api_status" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "id_column" TEXT NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "active_generation" INTEGER,
    "last_import_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "generation" INTEGER NOT NULL,
    "file_name" TEXT,
    "file_size" INTEGER,
    "temp_path" TEXT,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apis" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "feed_type" "feed_type" NOT NULL DEFAULT 'product',
    "status" "api_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "apis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_organization_id_name_key" ON "data_sources"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_id_organization_id_key" ON "data_sources"("id", "organization_id");

-- CreateIndex
CREATE INDEX "data_imports_data_source_id_created_at_idx" ON "data_imports"("data_source_id", "created_at");

-- CreateIndex
CREATE INDEX "data_imports_status_idx" ON "data_imports"("status");

-- CreateIndex
CREATE INDEX "records_data_source_id_generation_position_idx" ON "records"("data_source_id", "generation", "position");

-- CreateIndex
CREATE INDEX "records_organization_id_idx" ON "records"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "records_data_source_id_generation_external_id_key" ON "records"("data_source_id", "generation", "external_id");

-- CreateIndex
CREATE INDEX "apis_data_source_id_idx" ON "apis"("data_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "apis_organization_id_slug_key" ON "apis"("organization_id", "slug");

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_data_source_id_organization_id_fkey" FOREIGN KEY ("data_source_id", "organization_id") REFERENCES "data_sources"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_data_source_id_organization_id_fkey" FOREIGN KEY ("data_source_id", "organization_id") REFERENCES "data_sources"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apis" ADD CONSTRAINT "apis_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apis" ADD CONSTRAINT "apis_data_source_id_organization_id_fkey" FOREIGN KEY ("data_source_id", "organization_id") REFERENCES "data_sources"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── Added by hand (Prisma's schema language can't express these) ─────────────────────────

-- Only ONE queued or running import per data source, enforced by Postgres.
-- A second upload at the same moment fails this index → our API answers 409 IMPORT_IN_PROGRESS.
-- ("Partial" index: it only contains rows matching the WHERE, so finished imports don't count.)
CREATE UNIQUE INDEX "data_imports_one_active_per_data_source"
  ON "data_imports" ("data_source_id")
  WHERE "status" IN ('queued', 'running');

-- Only known values in the text status/mode columns (text, not enums, so new values are easy later).
ALTER TABLE "data_imports"
  ADD CONSTRAINT "data_imports_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  ADD CONSTRAINT "data_imports_mode_check"   CHECK ("mode"   IN ('initial', 'replace', 'merge'));

-- Generations and positions start at 1; counts are never negative.
ALTER TABLE "records"
  ADD CONSTRAINT "records_generation_check" CHECK ("generation" >= 1),
  ADD CONSTRAINT "records_position_check"   CHECK ("position" >= 1);
ALTER TABLE "data_sources"
  ADD CONSTRAINT "data_sources_row_count_check" CHECK ("row_count" >= 0);
