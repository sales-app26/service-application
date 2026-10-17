-- Reverses 11_lead_business_name.sql. A lead saved without a person's name takes its business
-- name as the name, so none is left empty.
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_named;
UPDATE sales.leads SET name = btrim(business_name) WHERE name IS NULL;

ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_name_present;
ALTER TABLE sales.leads ADD CONSTRAINT leads_name_present CHECK (length(btrim(name)) > 0);
ALTER TABLE sales.leads ALTER COLUMN name SET NOT NULL;
