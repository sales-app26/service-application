-- Deal terms: which plan was sold, for how long, at what list price and with which
-- discount — and the plan prices and offers the sales head sets for the company.
--
--  - leads.plan_code: free | growth | growth_plus | pro. New deals are written here.
--    The old free-text leads.plan stays for history: it still displays, nothing new
--    is written to it, and a deal saved with the new fields clears it (one or the other).
--  - leads.deal_tenure_months: 1, 3, 6 or 12. NULL reads as 1 (every deal before this).
--  - leads.deal_value keeps its meaning: the list price per month, before any discount.
--  - leads.discount_type / discount_value: 'percent' (0–100, two decimals) or 'amount'
--    (whole rupees off the whole deal, never more than price × tenure).
--  - leads.coupon_code: the code the client used, with a discount only.
--  - leads.offer_id: the offer picked, NULL for a discount typed by hand. The offer's
--    discount and coupon are copied onto the lead when saved, so editing or ending an
--    offer later never changes a deal already won.
--  - plan_prices: one row per plan; monthly_price NULL until the sales head sets it.
--    Free is always 0.
--  - offers: company-wide. "Ended" is active = false; removing one hides it
--    (deleted_at) and keeps its name on the deals that used it.
--
-- Won revenue is (price × tenure − discount) / tenure; see reports/revenue-rules.ts.
--
-- Idempotent, so a database where it was applied by hand is left as it is.
CREATE TABLE IF NOT EXISTS sales.plan_prices (
  plan          text        PRIMARY KEY,
  monthly_price integer,
  updated_by    uuid        REFERENCES sales.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_prices_plan_valid CHECK (plan IN ('free', 'growth', 'growth_plus', 'pro')),
  CONSTRAINT plan_prices_price_range
    CHECK (monthly_price IS NULL OR monthly_price BETWEEN 0 AND 100000000),
  CONSTRAINT plan_prices_free_is_free CHECK (plan <> 'free' OR monthly_price = 0)
);

INSERT INTO sales.plan_prices (plan, monthly_price) VALUES
  ('free', 0), ('growth', NULL), ('growth_plus', NULL), ('pro', NULL)
ON CONFLICT (plan) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'plan_prices_set_updated_at') THEN
    CREATE TRIGGER plan_prices_set_updated_at BEFORE UPDATE ON sales.plan_prices
      FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales.offers (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text          NOT NULL,
  coupon_code    text,
  discount_type  text          NOT NULL,
  discount_value numeric(12,2) NOT NULL,
  starts_on      date,
  ends_on        date,
  active         boolean       NOT NULL DEFAULT true,
  created_by     uuid          NOT NULL REFERENCES sales.users (id),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT offers_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 60 AND name = btrim(name)),
  CONSTRAINT offers_coupon_code_format
    CHECK (coupon_code IS NULL OR coupon_code ~ '^[A-Z0-9_-]{1,40}$'),
  CONSTRAINT offers_discount_type_valid CHECK (discount_type IN ('percent', 'amount')),
  CONSTRAINT offers_discount_range CHECK (
    discount_value > 0
    AND (discount_type <> 'percent' OR discount_value <= 100)
    AND (discount_type <> 'amount' OR discount_value = trunc(discount_value))
  ),
  CONSTRAINT offers_ends_after_start
    CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'offers_set_updated_at') THEN
    CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON sales.offers
      FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();
  END IF;
END $$;

ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS plan_code text;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS deal_tenure_months smallint;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS discount_type text;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS discount_value numeric(12,2);
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE sales.leads ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES sales.offers (id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_plan_code_valid') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_plan_code_valid
      CHECK (plan_code IS NULL OR plan_code IN ('free', 'growth', 'growth_plus', 'pro'));
  END IF;
  -- The old free text is history: a deal saved with a plan chip replaces it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_plan_one_kind') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_plan_one_kind
      CHECK (plan IS NULL OR plan_code IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_deal_tenure_valid') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_deal_tenure_valid
      CHECK (deal_tenure_months IS NULL OR deal_tenure_months IN (1, 3, 6, 12));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_discount_type_valid') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_discount_type_valid
      CHECK (discount_type IS NULL OR discount_type IN ('percent', 'amount'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_discount_pair') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_discount_pair
      CHECK ((discount_type IS NULL) = (discount_value IS NULL));
  END IF;
  -- A discount is off a price: percent 0–100, whole rupees at most the deal total.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_discount_range') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_discount_range CHECK (
      discount_type IS NULL OR (
        deal_value IS NOT NULL
        AND discount_value >= 0
        AND (discount_type <> 'percent' OR discount_value <= 100)
        AND (discount_type <> 'amount' OR (
          discount_value = trunc(discount_value)
          AND discount_value <= deal_value::numeric * coalesce(deal_tenure_months, 1)
        ))
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_coupon_code_format') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_coupon_code_format
      CHECK (coupon_code IS NULL OR (coupon_code ~ '^[A-Z0-9_-]{1,40}$' AND discount_type IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_offer_has_discount') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_offer_has_discount
      CHECK (offer_id IS NULL OR discount_type IS NOT NULL);
  END IF;
  -- Free costs nothing and runs no term: no price, tenure or discount.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_free_plan_is_free') THEN
    ALTER TABLE sales.leads ADD CONSTRAINT leads_free_plan_is_free CHECK (
      plan_code IS DISTINCT FROM 'free'
      OR (coalesce(deal_value, 0) = 0 AND deal_tenure_months IS NULL AND discount_type IS NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_offer_idx ON sales.leads (offer_id) WHERE offer_id IS NOT NULL;
