-- Safety rules Postgres enforces itself (Prisma can't express CHECK constraints).
-- A token row must look like one of ours.
ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_name_len" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "api_tokens_hint_format" CHECK ("hint" ~ '^rtk_[A-Za-z0-9_-]{4}$'),
  ADD CONSTRAINT "api_tokens_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  -- A revoked token keeps no readable copy; an active one must have one.
  ADD CONSTRAINT "api_tokens_revoked_no_copy" CHECK (("revoked_at" IS NULL) = ("token_encrypted" IS NOT NULL));

-- A published API always records when it was published.
ALTER TABLE "apis"
  ADD CONSTRAINT "apis_published_has_date" CHECK ("status" <> 'published' OR "published_at" IS NOT NULL);
