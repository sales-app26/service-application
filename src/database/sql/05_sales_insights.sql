-- Sales insights: what a lead is worth, where it came from, who added it, when
-- it was last worked, and why it was lost.
--
--  - leads.deal_value / plan: rupees per month and the plan sold, set when the
--    lead is added or converted. Revenue is the sum over converted leads.
--  - leads.source: how the lead was found. 'import' is set by the CSV import.
--  - leads.created_by: who added it — the person who logged its first entry, or
--    the admin who imported it. Credits "new leads" even after a transfer.
--  - leads.last_activity_at: the time of the latest entry, else when the lead
--    was added. Drives "cold" leads and the "longest untouched" sort.
--  - follow_ups.reason: why a lead was marked Not interested or Lost.
--
-- Idempotent, so a database where it was applied by hand is left as it is: the
-- backfills only touch rows still NULL.
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS deal_value integer;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES sales.users (id);
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE sales.follow_ups ADD COLUMN IF NOT EXISTS reason text;

-- Whoever logged the lead's first entry added it. Imported leads have no entry
-- yet and stay NULL: who imported them was never recorded.
UPDATE sales.leads l
   SET created_by = first_entry.user_id
  FROM (
    SELECT DISTINCT ON (f.lead_id) f.lead_id, f.user_id
      FROM sales.follow_ups f
     ORDER BY f.lead_id, f.created_at, f.id
  ) first_entry
 WHERE first_entry.lead_id = l.id
   AND l.created_by IS NULL;

UPDATE sales.leads l
   SET last_activity_at = coalesce(
         (SELECT max(f.created_at) FROM sales.follow_ups f
           WHERE f.lead_id = l.id AND f.deleted_at IS NULL),
         l.created_at)
 WHERE l.last_activity_at IS NULL;

ALTER TABLE sales.leads ALTER COLUMN last_activity_at SET DEFAULT now();
ALTER TABLE sales.leads ALTER COLUMN last_activity_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_deal_value_range') THEN
    ALTER TABLE sales.leads
      ADD CONSTRAINT leads_deal_value_range
      CHECK (deal_value IS NULL OR deal_value BETWEEN 0 AND 100000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_plan_present') THEN
    ALTER TABLE sales.leads
      ADD CONSTRAINT leads_plan_present
      CHECK (plan IS NULL OR (char_length(plan) BETWEEN 1 AND 80 AND plan = btrim(plan)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_valid') THEN
    ALTER TABLE sales.leads
      ADD CONSTRAINT leads_source_valid CHECK (source IS NULL OR source IN (
        'walk_in', 'referral', 'phone', 'whatsapp', 'social', 'event', 'import', 'other'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_reason_valid') THEN
    ALTER TABLE sales.follow_ups
      ADD CONSTRAINT follow_ups_reason_valid CHECK (reason IS NULL OR reason IN (
        'price', 'has_alternative', 'not_ready', 'no_need', 'owner_unavailable',
        'shop_closed', 'competitor', 'other'
      ));
  END IF;
  -- A reason explains a lead that was turned down, nothing else.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_reason_only_when_closed') THEN
    ALTER TABLE sales.follow_ups
      ADD CONSTRAINT follow_ups_reason_only_when_closed
      CHECK (reason IS NULL OR status IN ('not_interested', 'lost'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_owner_last_activity_idx
  ON sales.leads (owner_id, last_activity_at) WHERE deleted_at IS NULL;
