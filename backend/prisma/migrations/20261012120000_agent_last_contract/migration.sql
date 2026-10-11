-- Task 5.6: the contract the user last took out of the app (copied / downloaded), so an agent can
-- say "out of date" when the design (or URL, header style, its fields) changes it afterwards.
ALTER TABLE "jivox_agents" ADD COLUMN     "last_contract_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_contract_design_version" INTEGER,
ADD COLUMN     "last_contract_how" TEXT,
ADD COLUMN     "last_contract_shape" JSONB;

-- All four together or none; how is one of the known ways; the shape is a JSON object (<= 64 KB).
-- Every column is tested with IS NOT NULL first: a CHECK that comes out NULL counts as passed, so
-- "jsonb_typeof(NULL) = 'object'" alone would let a half-filled row in.
ALTER TABLE "jivox_agents" ADD CONSTRAINT "jivox_agents_last_contract_check" CHECK (
  (last_contract_at IS NULL AND last_contract_how IS NULL AND last_contract_design_version IS NULL AND last_contract_shape IS NULL)
  OR (last_contract_at IS NOT NULL
      AND last_contract_how IS NOT NULL AND last_contract_how IN ('copy', 'download', 'submit')
      AND last_contract_design_version IS NOT NULL AND last_contract_design_version >= 0
      AND last_contract_shape IS NOT NULL AND jsonb_typeof(last_contract_shape) = 'object'
      AND octet_length(last_contract_shape::text) <= 65536)
);
