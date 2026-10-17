-- Leads with no owner yet: a bulk upload can leave leads unassigned, for an admin to hand
-- out later.
--
--  - leads.owner_id may be NULL: the lead waits in its campaign's "Not assigned" list, seen
--    only by the campaign's admins. Nobody logs on it or moves it until it is assigned, so an
--    unassigned lead is always New (leads_unassigned_new) and never carries a win.
--  - lead_transfers.from_user_id may be NULL for the record of assigning such a lead, which is
--    approved as it is made; requests always come from an owner.
--
-- No existing row changes. Idempotent, so a database where it was applied by hand is left as
-- it is.
ALTER TABLE sales.leads ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_unassigned_new;
ALTER TABLE sales.leads ADD CONSTRAINT leads_unassigned_new
  CHECK (owner_id IS NOT NULL OR status = 'new');

CREATE INDEX IF NOT EXISTS leads_project_unassigned_idx
  ON sales.leads (project_id, created_at) WHERE owner_id IS NULL AND deleted_at IS NULL;

ALTER TABLE sales.lead_transfers ALTER COLUMN from_user_id DROP NOT NULL;

ALTER TABLE sales.lead_transfers DROP CONSTRAINT IF EXISTS lead_transfers_from_present;
ALTER TABLE sales.lead_transfers ADD CONSTRAINT lead_transfers_from_present
  CHECK (from_user_id IS NOT NULL OR status = 'approved');
