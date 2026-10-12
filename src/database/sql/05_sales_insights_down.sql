-- Reverses 05_sales_insights.sql. Deal values, plans, sources, who added each lead,
-- last activity and lost reasons are dropped with their columns.
DROP INDEX IF EXISTS sales.leads_owner_last_activity_idx;
ALTER TABLE sales.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_reason_only_when_closed;
ALTER TABLE sales.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_reason_valid;
ALTER TABLE sales.follow_ups DROP COLUMN IF EXISTS reason;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_source_valid;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_plan_present;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_deal_value_range;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS last_activity_at;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS created_by;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS source;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS plan;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS deal_value;
