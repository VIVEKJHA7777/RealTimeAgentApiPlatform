-- Written by hand (Prisma's schema language can't express a column collation).
--
-- Ids are compared byte by byte ("C" collation) instead of by English language rules.
-- Why: with language rules Postgres can NOT use an index for `external_id LIKE 'SKU-12%'`,
-- so searching by id prefix in a 500 000-row data source read every row. With "C" the
-- existing unique index (data_source_id, generation, external_id) answers prefix searches
-- directly, and comparing versions during an import (joins on external_id) gets faster too.
-- Rebuilds that index (fast: the table is small or empty at this point).
ALTER TABLE "records" ALTER COLUMN "external_id" TYPE TEXT COLLATE "C";
