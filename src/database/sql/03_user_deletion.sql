-- Deleting a user (Super Admin): their login and personal details are erased, but
-- the row stays so every visit, follow-up and transfer they logged keeps its
-- foreign keys. The row then reads "Deleted user" with a placeholder email.
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_deleted_inactive') THEN
    ALTER TABLE sales.users
      ADD CONSTRAINT users_deleted_inactive CHECK (deleted_at IS NULL OR NOT is_active);
  END IF;
END $$;
