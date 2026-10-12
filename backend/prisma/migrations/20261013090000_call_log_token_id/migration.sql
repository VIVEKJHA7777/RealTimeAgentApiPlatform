-- Task 7.3: which token of the API made a call (token names repeat: two agents' tokens may share one).
-- No foreign key on purpose: the log is history and must not block anything about tokens.
ALTER TABLE "api_call_logs" ADD COLUMN "token_id" TEXT;

-- Hand-written: only a call made with one of THIS API's tokens names it, and an id is short.
ALTER TABLE "api_call_logs"
  ADD CONSTRAINT "api_call_logs_token_id" CHECK (
    "token_id" IS NULL OR (COALESCE("token_kind" = 'this_api', false) AND char_length("token_id") BETWEEN 1 AND 64));
