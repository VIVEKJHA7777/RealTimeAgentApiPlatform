-- CreateTable
CREATE TABLE "api_recent_calls" (
    "api_id" TEXT NOT NULL,
    "calls" JSONB NOT NULL DEFAULT '[]',
    "cleared_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_recent_calls_pkey" PRIMARY KEY ("api_id")
);

-- AddForeignKey
ALTER TABLE "api_recent_calls" ADD CONSTRAINT "api_recent_calls_api_id_fkey" FOREIGN KEY ("api_id") REFERENCES "apis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: the list is always a JSON array of at most 5 calls.
ALTER TABLE "api_recent_calls"
  ADD CONSTRAINT "api_recent_calls_list" CHECK (jsonb_typeof("calls") = 'array' AND jsonb_array_length("calls") <= 5);
