-- Reverses 01_sales_schema.sql. Destroys every lead and entry — never run on production data.
-- The `sales` schema itself is kept: TypeORM's migrations table lives in it.
DROP TABLE IF EXISTS sales.lead_transfers;
DROP TABLE IF EXISTS sales.follow_ups;
DROP TABLE IF EXISTS sales.leads;
DROP TABLE IF EXISTS sales.locations;
DROP TABLE IF EXISTS sales.project_members;
DROP TABLE IF EXISTS sales.projects;
DROP TABLE IF EXISTS sales.users;
DROP FUNCTION IF EXISTS sales.set_updated_at();
