-- Leads: the business name comes first, the person's name is optional.
--
-- Most leads arrive as a shop with no owner or manager name yet. leads.name (the person at
-- the business) may now be empty; the API requires business_name on every new lead and never
-- lets it be cleared. Older leads saved with only a person's name stay as they are, so every
-- lead still has one or the other (leads_named). No existing row changes.
--
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.leads ALTER COLUMN name DROP NOT NULL;

ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_name_present;
ALTER TABLE sales.leads ADD CONSTRAINT leads_name_present
  CHECK (name IS NULL OR length(btrim(name)) > 0);

ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_named;
ALTER TABLE sales.leads ADD CONSTRAINT leads_named
  CHECK (name IS NOT NULL OR length(btrim(coalesce(business_name, ''))) > 0);
