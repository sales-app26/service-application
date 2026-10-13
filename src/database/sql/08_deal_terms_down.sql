-- Reverses 08_deal_terms.sql. Deals keep their monthly price and old plan text but
-- lose the plan chip, tenure, discount, coupon and offer; revenue reads the monthly
-- price again. Plan prices and offers are dropped.
DROP INDEX IF EXISTS sales.leads_offer_idx;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_free_plan_is_free;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_offer_has_discount;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_coupon_code_format;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_discount_range;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_discount_pair;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_discount_type_valid;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_deal_tenure_valid;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_plan_one_kind;
ALTER TABLE sales.leads DROP CONSTRAINT IF EXISTS leads_plan_code_valid;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS offer_id;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS coupon_code;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS discount_value;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS discount_type;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS deal_tenure_months;
ALTER TABLE sales.leads DROP COLUMN IF EXISTS plan_code;
DROP TABLE IF EXISTS sales.offers;
DROP TABLE IF EXISTS sales.plan_prices;
