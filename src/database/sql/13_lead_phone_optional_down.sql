-- Reverses 13_lead_phone_optional.sql. A number can't be made up for leads saved without one,
-- so this stops, changing nothing, while any lead (deleted or not) has no phone. Add their
-- numbers, or remove those leads for good, then run it again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales.leads WHERE phone IS NULL) THEN
    RAISE EXCEPTION 'Some leads have no phone. Add their numbers or remove them, then revert again.';
  END IF;
END $$;

ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_phone_format;
ALTER TABLE sales.leads ADD CONSTRAINT leads_phone_format CHECK (phone ~ '^[6-9][0-9]{9}$');

ALTER TABLE sales.leads ALTER COLUMN phone SET NOT NULL;
