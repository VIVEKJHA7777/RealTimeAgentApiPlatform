-- CreateTable
CREATE TABLE "api_call_logs" (
    "id" BIGSERIAL NOT NULL,
    "api_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'call',
    "at" TIMESTAMPTZ(3) NOT NULL,
    "method" TEXT,
    "path" TEXT,
    "query" JSONB,
    "body" TEXT,
    "body_bytes" INTEGER NOT NULL DEFAULT 0,
    "request_headers" JSONB,
    "token_kind" TEXT,
    "token_name" TEXT,
    "header" TEXT,
    "ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id_count" INTEGER,
    "meta" JSONB,
    "request_check" JSONB,
    "status" INTEGER,
    "envelope_status" TEXT,
    "error_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "found" INTEGER,
    "response_headers" JSONB,
    "response_body" TEXT,
    "duration_ms" DOUBLE PRECISION,
    "switches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ip" TEXT,
    "user_agent" TEXT,
    "event" JSONB,

    CONSTRAINT "api_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_test_switches" (
    "id" TEXT NOT NULL,
    "api_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "token_id" TEXT,
    "apply_to_own_checks" BOOLEAN NOT NULL DEFAULT false,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_test_switches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_call_logs_api_id_id_idx" ON "api_call_logs"("api_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "api_test_switches_api_id_kind_key" ON "api_test_switches"("api_id", "kind");

-- AddForeignKey
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_test_switches" ADD CONSTRAINT "api_test_switches_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_test_switches" ADD CONSTRAINT "api_test_switches_token_id_api_id_fkey" FOREIGN KEY ("token_id", "api_id") REFERENCES "api_tokens"("id", "api_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_test_switches" ADD CONSTRAINT "api_test_switches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Hand-written: rules Postgres enforces itself (Prisma can't express them). Columns a rule needs are
-- tested IS NOT NULL first where they must be set (a CHECK that comes out NULL counts as passed).

-- ── The call log ──
ALTER TABLE "api_call_logs"
  ADD CONSTRAINT "api_call_logs_kind" CHECK ("kind" IN ('call', 'switch')),
  -- a call has its request line; a switch line has its event (and nothing of a call)
  ADD CONSTRAINT "api_call_logs_shape" CHECK (
    ("kind" = 'call' AND "method" IS NOT NULL AND "path" IS NOT NULL AND "event" IS NULL)
    OR ("kind" = 'switch' AND "event" IS NOT NULL AND jsonb_typeof("event") = 'object' AND "method" IS NULL)),
  -- never a secret header (the code removes them; this is the last word)
  ADD CONSTRAINT "api_call_logs_no_secret_headers" CHECK ("request_headers" IS NULL OR NOT ("request_headers" ?| ARRAY['authorization', 'x-api-key', 'cookie', 'set-cookie'])),
  ADD CONSTRAINT "api_call_logs_sizes" CHECK (
    ("path" IS NULL OR char_length("path") <= 2048)
    AND ("body" IS NULL OR char_length("body") <= 4096)
    AND ("response_body" IS NULL OR char_length("response_body") <= 4096)
    AND ("user_agent" IS NULL OR char_length("user_agent") <= 300)
    AND ("token_name" IS NULL OR char_length("token_name") <= 100)
    AND ("request_headers" IS NULL OR octet_length("request_headers"::text) <= 8192)
    AND ("response_headers" IS NULL OR octet_length("response_headers"::text) <= 8192)
    AND ("query" IS NULL OR octet_length("query"::text) <= 8192)
    AND ("request_check" IS NULL OR octet_length("request_check"::text) <= 8192)
    AND "body_bytes" >= 0),
  ADD CONSTRAINT "api_call_logs_lists" CHECK (
    "ids" IS NOT NULL AND cardinality("ids") <= 100 AND array_position("ids", NULL) IS NULL
    AND "error_codes" IS NOT NULL AND cardinality("error_codes") <= 20
    AND "switches" IS NOT NULL AND "switches" <@ ARRAY['no_store', 'status_failure', 'duplicate_id', 'drop_id', 'extra_id', 'item_without_id', 'wrong_type', 'slow', 'http_status', 'empty_data', 'not_json', 'strict']::text[]),
  ADD CONSTRAINT "api_call_logs_numbers" CHECK (
    ("status" IS NULL OR "status" BETWEEN 100 AND 599)
    AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
    AND ("id_count" IS NULL OR "id_count" >= 0)
    AND ("found" IS NULL OR "found" >= 0)),
  ADD CONSTRAINT "api_call_logs_token_kind" CHECK ("token_kind" IS NULL OR "token_kind" IN ('this_api', 'other_api', 'unknown', 'not_checked', 'none')),
  ADD CONSTRAINT "api_call_logs_header" CHECK ("header" IS NULL OR "header" IN ('x_api_key', 'bearer'));

-- ── Test switches ──
ALTER TABLE "api_test_switches"
  ADD CONSTRAINT "api_test_switches_kind" CHECK ("kind" IN ('no_store', 'status_failure', 'duplicate_id', 'drop_id', 'extra_id', 'item_without_id', 'wrong_type', 'slow', 'http_status', 'empty_data', 'not_json', 'strict')),
  -- each kind's options: wrong_type names a field, slow says how long, http_status which status; the rest none.
  -- COALESCE(…, false): a missing key makes jsonb_typeof NULL, and a CHECK that comes out NULL would PASS.
  ADD CONSTRAINT "api_test_switches_options" CHECK (
    "options" IS NOT NULL AND jsonb_typeof("options") = 'object' AND CASE "kind"
      WHEN 'wrong_type' THEN COALESCE(jsonb_typeof("options"->'field') = 'string' AND char_length("options"->>'field') BETWEEN 1 AND 100, false)
      WHEN 'slow' THEN COALESCE(jsonb_typeof("options"->'ms') = 'number' AND ("options"->>'ms')::numeric BETWEEN 1 AND 30000, false)
      WHEN 'http_status' THEN COALESCE(jsonb_typeof("options"->'status') = 'number' AND ("options"->>'status')::numeric IN (400, 401, 403, 404, 429, 500, 502, 503), false)
      ELSE "options" = '{}'::jsonb
    END),
  -- it ends after it was set, and at most 24 h after its last change (P7-2)
  ADD CONSTRAINT "api_test_switches_ends" CHECK ("ends_at" > "created_at" AND "ends_at" <= "updated_at" + interval '24 hours');
