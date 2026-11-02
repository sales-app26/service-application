-- Calls next to visits, and reminders.
--
-- A person is marked Field, Calling or Both. Every new follow-up says what kind it is: a visit
-- proves itself with a photo and position, a call that connected with an uploaded recording. A
-- call nobody answered proves nothing and moves nothing: it keeps the lead's status.
--
-- A next follow-up can carry a time and a kind, and a time is what the reminders fire on.
--
-- Older entries with a photo become visits. The rest stay empty: we don't know what they were.
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.users
  ADD COLUMN IF NOT EXISTS work_type text NOT NULL DEFAULT 'field',
  ADD COLUMN IF NOT EXISTS follow_up_digest_on date;
UPDATE sales.users SET work_type = 'both' WHERE role <> 'sales_person' AND work_type = 'field';

ALTER TABLE sales.follow_ups
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS call_outcome text,
  ADD COLUMN IF NOT EXISTS recording_path text,
  ADD COLUMN IF NOT EXISTS recording_sha256 text,
  ADD COLUMN IF NOT EXISTS next_follow_up_time text,
  ADD COLUMN IF NOT EXISTS next_follow_up_channel text;
UPDATE sales.follow_ups SET channel = 'visit' WHERE photo_path IS NOT NULL AND channel IS NULL;

ALTER TABLE sales.leads
  ADD COLUMN IF NOT EXISTS next_follow_up_time text,
  ADD COLUMN IF NOT EXISTS next_follow_up_channel text,
  -- The moment last reminded about, so a rescheduled follow-up reminds again.
  ADD COLUMN IF NOT EXISTS reminded_for timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_work_type_valid') THEN
    ALTER TABLE sales.users
      ADD CONSTRAINT users_work_type_valid CHECK (work_type IN ('field', 'calling', 'both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_channel_valid') THEN
    ALTER TABLE sales.follow_ups
      ADD CONSTRAINT follow_ups_channel_valid
        CHECK (channel IS NULL OR channel IN ('visit', 'call', 'other')),
      ADD CONSTRAINT follow_ups_call_outcome_valid CHECK (call_outcome IS NULL OR call_outcome IN (
        'spoke', 'no_answer', 'busy', 'switched_off', 'wrong_number'
      )),
      -- A call always says how it went; only a call does.
      ADD CONSTRAINT follow_ups_call_has_outcome
        CHECK ((channel = 'call') = (call_outcome IS NOT NULL)),
      -- A call that connected has its recording, the way a visit has its photo.
      ADD CONSTRAINT follow_ups_spoke_has_recording
        CHECK (call_outcome IS DISTINCT FROM 'spoke' OR recording_path IS NOT NULL),
      ADD CONSTRAINT follow_ups_recording_only_on_calls
        CHECK (recording_path IS NULL OR channel = 'call'),
      ADD CONSTRAINT follow_ups_next_time_format CHECK (
        next_follow_up_time IS NULL OR next_follow_up_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ),
      ADD CONSTRAINT follow_ups_next_channel_valid
        CHECK (next_follow_up_channel IS NULL OR next_follow_up_channel IN ('visit', 'call'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_next_time_format') THEN
    ALTER TABLE sales.leads
      ADD CONSTRAINT leads_next_time_format CHECK (
        next_follow_up_time IS NULL OR next_follow_up_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ),
      ADD CONSTRAINT leads_next_channel_valid
        CHECK (next_follow_up_channel IS NULL OR next_follow_up_channel IN ('visit', 'call'));
  END IF;
END $$;

-- One recording proves one call, as one capture token proves one visit.
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_recording_sha256_key
  ON sales.follow_ups (recording_sha256) WHERE recording_sha256 IS NOT NULL;

-- What the reminder job looks through every minute.
CREATE INDEX IF NOT EXISTS leads_timed_follow_up_idx
  ON sales.leads (next_follow_up_date)
  WHERE next_follow_up_time IS NOT NULL AND deleted_at IS NULL;

-- A device to push reminders to. A person can have several.
CREATE TABLE IF NOT EXISTS sales.push_subscriptions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES sales.users (id) ON DELETE CASCADE,
  endpoint   text        NOT NULL UNIQUE,
  p256dh     text        NOT NULL,
  auth       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON sales.push_subscriptions (user_id);

ALTER TABLE sales.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE sales.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'transfer_requested', 'transfer_decided', 'lead_assigned', 'mention', 'help_requested',
  'help_resolved', 'comment', 'feedback', 'leave_cover', 'training', 'follow_up_reminder'
));
