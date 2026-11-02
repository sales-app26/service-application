-- Invite links that don't expire.
--
-- Supabase's own tokens expire with its OTP setting (a day at most), so the invite email now
-- carries a token of ours. Only its SHA-256 is kept, on the person's row, and it is cleared
-- once they have a password: a value here means "invited, not in yet".
--
-- People already invited who never got in are marked too, with a hash nobody holds the token
-- for. Their old emailed link stays dead, and a resend gives them one that lasts. Where
-- auth.users can't be read (the test database) there is no one to mark.
--
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.users ADD COLUMN IF NOT EXISTS invite_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS users_invite_token_hash_unique
  ON sales.users (invite_token_hash) WHERE invite_token_hash IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE sales.users u
    SET invite_token_hash = encode(sha256(gen_random_uuid()::text::bytea), 'hex')
    FROM auth.users a
    WHERE a.id = u.id
      AND u.invite_token_hash IS NULL
      AND u.deleted_at IS NULL
      AND a.invited_at IS NOT NULL
      AND a.last_sign_in_at IS NULL;
  END IF;
END $$;
