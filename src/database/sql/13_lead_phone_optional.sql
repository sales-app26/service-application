-- Leads: the phone is optional.
--
-- A bulk upload often lists shops with no number yet. leads.phone may now be empty. Every number
-- that is given still has to be a 10-digit Indian mobile (leads_phone_format), and the unique
-- index on (project_id, phone) skips empty ones, so leads without a number never clash. Adding a
-- lead by hand still asks for a phone; the API requires it there.
--
-- No existing row changes. Idempotent, so a database where it was applied by hand is left as
-- it is.
ALTER TABLE sales.leads ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_phone_format;
ALTER TABLE sales.leads ADD CONSTRAINT leads_phone_format
  CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$');
