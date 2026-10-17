-- Reverses 12_unassigned_leads.sql. Leads still unassigned go to whoever added them (the admin
-- who uploaded the sheet); the records of assigning leads out of the pool are removed.
ALTER TABLE sales.lead_transfers DROP CONSTRAINT IF EXISTS lead_transfers_from_present;
DELETE FROM sales.lead_transfers WHERE from_user_id IS NULL;
ALTER TABLE sales.lead_transfers ALTER COLUMN from_user_id SET NOT NULL;

DROP INDEX IF EXISTS sales.leads_project_unassigned_idx;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_unassigned_new;
UPDATE sales.leads SET owner_id = created_by WHERE owner_id IS NULL;
ALTER TABLE sales.leads ALTER COLUMN owner_id SET NOT NULL;
