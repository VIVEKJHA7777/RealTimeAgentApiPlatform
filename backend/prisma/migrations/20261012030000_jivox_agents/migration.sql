-- CreateTable
CREATE TABLE "jivox_agents" (
    "id" TEXT NOT NULL,
    "api_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandstore" TEXT,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_id" TEXT,
    "mcp_url" TEXT,
    "access_key_encrypted" TEXT,
    "access_key_hint" TEXT,
    "sample_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_info" JSONB,
    "agent_info_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jivox_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jivox_agents_api_id_created_at_idx" ON "jivox_agents"("api_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_id_api_id_key" ON "api_tokens"("id", "api_id");

-- AddForeignKey
ALTER TABLE "jivox_agents" ADD CONSTRAINT "jivox_agents_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jivox_agents" ADD CONSTRAINT "jivox_agents_token_id_api_id_fkey" FOREIGN KEY ("token_id", "api_id") REFERENCES "api_tokens"("id", "api_id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Hand-written: rules Postgres enforces itself (Prisma can't express them).
-- An agent's name is unique within its API, whatever the case or surrounding spaces.
CREATE UNIQUE INDEX "jivox_agents_api_name_key" ON "jivox_agents" ("api_id", lower(btrim("name")));

ALTER TABLE "jivox_agents"
  ADD CONSTRAINT "jivox_agents_name_len" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "jivox_agents_brandstore_len" CHECK ("brandstore" IS NULL OR char_length(btrim("brandstore")) BETWEEN 1 AND 100),
  -- Jivox column names: snake_case, at most 100 per agent, no NULL entries.
  ADD CONSTRAINT "jivox_agents_fields_list" CHECK (
    "fields" IS NOT NULL AND cardinality("fields") <= 100 AND array_position("fields", NULL) IS NULL
    AND array_to_string("fields", ' ') ~ '^([a-z][a-z0-9_]{0,99}( [a-z][a-z0-9_]{0,99})*)?$'),
  ADD CONSTRAINT "jivox_agents_sample_ids_list" CHECK (
    "sample_ids" IS NOT NULL AND cardinality("sample_ids") <= 10 AND array_position("sample_ids", NULL) IS NULL),
  ADD CONSTRAINT "jivox_agents_mcp_url_format" CHECK ("mcp_url" IS NULL OR ("mcp_url" ~ '^https?://[^[:space:]]+$' AND char_length("mcp_url") <= 500)),
  -- An access key is always stored together with its hint (and never one without the other).
  ADD CONSTRAINT "jivox_agents_access_key_pair" CHECK (("access_key_encrypted" IS NULL) = ("access_key_hint" IS NULL)),
  ADD CONSTRAINT "jivox_agents_access_key_shape" CHECK ("access_key_encrypted" IS NULL OR ("access_key_encrypted" LIKE 'v1.%' AND char_length("access_key_hint") BETWEEN 1 AND 4)),
  ADD CONSTRAINT "jivox_agents_agent_info_pair" CHECK (("agent_info" IS NULL) = ("agent_info_at" IS NULL)),
  ADD CONSTRAINT "jivox_agents_last_error_len" CHECK ("last_error" IS NULL OR char_length("last_error") <= 1000);
