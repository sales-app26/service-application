-- Reverses 14_invite_links.sql. Invite links already emailed stop working; people still waiting
-- can use "Forgot password?" or get a reset link from their manager.
DROP INDEX IF EXISTS sales.users_invite_token_hash_unique;
ALTER TABLE sales.users DROP COLUMN IF EXISTS invite_token_hash;
