-- CreateTable
CREATE TABLE "jivox_contract_actions" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "outcome" TEXT,
    "jivox_status" TEXT,
    "version" INTEGER,
    "mcp_host" TEXT NOT NULL,
    "design_version" INTEGER,
    "document" JSONB,
    "failed_checks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answer" JSONB,
    "error_message" TEXT,
    "started_by_id" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "jivox_contract_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jivox_contract_actions_agent_id_started_at_idx" ON "jivox_contract_actions"("agent_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "jivox_contract_actions" ADD CONSTRAINT "jivox_contract_actions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "jivox_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jivox_contract_actions" ADD CONSTRAINT "jivox_contract_actions_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Hand-written: rules Postgres enforces itself (Prisma can't express them). Every column that a rule
-- reads is tested IS NOT NULL first where it must be set: a CHECK that comes out NULL counts as passed.
-- At most ONE running Submit / Activate per agent (double clicks, two tabs, two people → 409 JIVOX_BUSY).
CREATE UNIQUE INDEX "jivox_contract_actions_one_running" ON "jivox_contract_actions" ("agent_id") WHERE "state" = 'running';

ALTER TABLE "jivox_contract_actions"
  ADD CONSTRAINT "jivox_contract_actions_kind" CHECK ("kind" IN ('submit', 'activate')),
  ADD CONSTRAINT "jivox_contract_actions_state" CHECK ("state" IN ('running', 'done', 'error')),
  -- running: no result yet. done: Jivox answered (an outcome + its answer). error: it didn't (an outcome + why).
  ADD CONSTRAINT "jivox_contract_actions_lifecycle" CHECK (
    ("state" = 'running' AND "finished_at" IS NULL AND "outcome" IS NULL)
    OR ("state" = 'done' AND "finished_at" IS NOT NULL AND "outcome" IS NOT NULL AND "answer" IS NOT NULL)
    OR ("state" = 'error' AND "finished_at" IS NOT NULL AND "outcome" IS NOT NULL AND "error_message" IS NOT NULL)),
  ADD CONSTRAINT "jivox_contract_actions_outcome" CHECK ("outcome" IS NULL OR "outcome" IN (
    'verified', 'failed', 'invalid', 'gate_failed',             -- submit, Jivox answered
    'activated', 'refused',                                      -- activate, Jivox answered
    'unknown',                                                   -- Jivox answered something we don't know yet
    'unreachable', 'auth_failed', 'bad_answer', 'timeout', 'interrupted')), -- no usable answer
  ADD CONSTRAINT "jivox_contract_actions_outcome_kind" CHECK (
    "outcome" IS NULL
    OR ("kind" = 'submit' AND "outcome" NOT IN ('activated', 'refused'))
    OR ("kind" = 'activate' AND "outcome" NOT IN ('verified', 'failed', 'invalid', 'gate_failed'))),
  -- submit: always the document sent; verified → its new version. activate: the target version from the start.
  ADD CONSTRAINT "jivox_contract_actions_submit_document" CHECK ("kind" <> 'submit' OR ("document" IS NOT NULL AND jsonb_typeof("document") = 'object')),
  ADD CONSTRAINT "jivox_contract_actions_activate_version" CHECK ("kind" <> 'activate' OR "version" IS NOT NULL),
  ADD CONSTRAINT "jivox_contract_actions_verified_version" CHECK ("outcome" IS DISTINCT FROM 'verified' OR "version" IS NOT NULL),
  ADD CONSTRAINT "jivox_contract_actions_version_positive" CHECK ("version" IS NULL OR "version" > 0),
  ADD CONSTRAINT "jivox_contract_actions_times" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
  ADD CONSTRAINT "jivox_contract_actions_sizes" CHECK (
    ("document" IS NULL OR octet_length("document"::text) <= 262144)
    AND ("answer" IS NULL OR octet_length("answer"::text) <= 65536)
    AND ("error_message" IS NULL OR char_length("error_message") <= 1000)
    AND ("jivox_status" IS NULL OR char_length("jivox_status") <= 50)
    AND char_length("mcp_host") BETWEEN 1 AND 255),
  ADD CONSTRAINT "jivox_contract_actions_failed_checks" CHECK (
    "failed_checks" IS NOT NULL AND cardinality("failed_checks") <= 50 AND array_position("failed_checks", NULL) IS NULL);
