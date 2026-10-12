-- Visit proof: one capture token proves one visit (B-01).
--
-- A capture token is signed and time-boxed, but on its own it could be sent with
-- any number of entries inside its 10 minutes, so one photo session could "prove"
-- several visits. Each door-to-door entry now stores a hash of the token it used,
-- and the unique index lets a token be spent once. Older rows keep NULL.
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.follow_ups ADD COLUMN IF NOT EXISTS capture_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_capture_token_hash_key
  ON sales.follow_ups (capture_token_hash) WHERE capture_token_hash IS NOT NULL;
