-- Reverses 15_calls_and_reminders.sql. Who works where, how calls went and every reminder are
-- lost. Recordings stay in their bucket, no longer linked to any entry.
DELETE FROM sales.notifications WHERE kind = 'follow_up_reminder';
ALTER TABLE sales.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE sales.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'transfer_requested', 'transfer_decided', 'lead_assigned', 'mention', 'help_requested',
  'help_resolved', 'comment', 'feedback', 'leave_cover', 'training'
));

DROP TABLE IF EXISTS sales.push_subscriptions;
DROP INDEX IF EXISTS sales.leads_timed_follow_up_idx;
DROP INDEX IF EXISTS sales.follow_ups_recording_sha256_key;

ALTER TABLE sales.leads
  DROP COLUMN IF EXISTS reminded_for,
  DROP COLUMN IF EXISTS next_follow_up_channel,
  DROP COLUMN IF EXISTS next_follow_up_time;
ALTER TABLE sales.follow_ups
  DROP COLUMN IF EXISTS next_follow_up_channel,
  DROP COLUMN IF EXISTS next_follow_up_time,
  DROP COLUMN IF EXISTS recording_sha256,
  DROP COLUMN IF EXISTS recording_path,
  DROP COLUMN IF EXISTS call_outcome,
  DROP COLUMN IF EXISTS channel;
ALTER TABLE sales.users
  DROP COLUMN IF EXISTS follow_up_digest_on,
  DROP COLUMN IF EXISTS work_type;
