-- Reverses 04_single_use_capture.sql. Capture tokens become reusable inside their window again.
DROP INDEX IF EXISTS sales.follow_ups_capture_token_hash_key;
ALTER TABLE sales.follow_ups DROP COLUMN IF EXISTS capture_token_hash;
