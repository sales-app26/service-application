-- Reverses 03_user_deletion.sql. Deleted users then look like deactivated ones.
ALTER TABLE sales.users DROP CONSTRAINT IF EXISTS users_deleted_inactive;
ALTER TABLE sales.users DROP COLUMN IF EXISTS deleted_at;
