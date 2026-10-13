-- Team collaboration: leave and cover, comments on leads, in-app notifications
-- and per-project message templates.
--
--  - user_leaves: a person is away from starts_on to ends_on (India dates,
--    inclusive). Cancelling keeps the row. At most 60 days per leave.
--  - project_members.backup_user_id: who covers this member's follow-ups in
--    this project while they are on leave.
--  - follow_ups.covering_for_id: the owner a backup logged this entry for. The
--    entry's user_id stays whoever logged it; the lead keeps its owner.
--  - lead_comments: comments, help requests, feedback on an entry and handover
--    notes on a lead, with mentions. One open help request per lead.
--  - notifications: what a person sees in the app's bell. Private to user_id.
--  - message_templates: canned messages for a project, with {client}, {rep}
--    and {business} placeholders stored verbatim.
--
-- Idempotent, so a database where it was applied by hand is left as it is.

-- -----------------------------------------------------------------------------
-- user_leaves
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.user_leaves (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES sales.users (id),
  starts_on    date        NOT NULL,
  ends_on      date        NOT NULL,
  note         text,
  created_by   uuid        NOT NULL REFERENCES sales.users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT user_leaves_ends_after_start CHECK (ends_on >= starts_on),
  CONSTRAINT user_leaves_span_max CHECK (ends_on - starts_on <= 60),
  CONSTRAINT user_leaves_note_length CHECK (note IS NULL OR char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS user_leaves_user_dates_idx
  ON sales.user_leaves (user_id, starts_on, ends_on) WHERE cancelled_at IS NULL;

-- -----------------------------------------------------------------------------
-- project_members.backup_user_id, follow_ups.covering_for_id
-- -----------------------------------------------------------------------------
ALTER TABLE sales.project_members
  ADD COLUMN IF NOT EXISTS backup_user_id uuid REFERENCES sales.users (id);
ALTER TABLE sales.follow_ups
  ADD COLUMN IF NOT EXISTS covering_for_id uuid REFERENCES sales.users (id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_members_backup_not_self') THEN
    ALTER TABLE sales.project_members
      ADD CONSTRAINT project_members_backup_not_self CHECK (backup_user_id <> user_id);
  END IF;
  -- Nobody covers for themselves.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_covering_not_self') THEN
    ALTER TABLE sales.follow_ups
      ADD CONSTRAINT follow_ups_covering_not_self
      CHECK (covering_for_id IS NULL OR covering_for_id <> user_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- lead_comments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.lead_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL,
  project_id  uuid        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES sales.users (id),
  entry_id    uuid        REFERENCES sales.follow_ups (id),
  kind        text        NOT NULL,
  body        text        NOT NULL,
  mention_ids uuid[]      NOT NULL DEFAULT '{}',
  pinned      boolean     NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES sales.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  CONSTRAINT lead_comments_kind_valid CHECK (kind IN ('comment', 'help', 'feedback', 'handover')),
  CONSTRAINT lead_comments_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  -- Resolved means resolved by someone, and only a help request is resolved.
  CONSTRAINT lead_comments_resolution_consistent CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  CONSTRAINT lead_comments_resolve_help_only CHECK (resolved_at IS NULL OR kind = 'help'),
  -- Feedback is always about one entry.
  CONSTRAINT lead_comments_feedback_has_entry CHECK (kind <> 'feedback' OR entry_id IS NOT NULL),
  CONSTRAINT lead_comments_lead_same_project
    FOREIGN KEY (lead_id, project_id) REFERENCES sales.leads (id, project_id)
);

CREATE INDEX IF NOT EXISTS lead_comments_lead_created_idx
  ON sales.lead_comments (lead_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_comments_entry_idx
  ON sales.lead_comments (entry_id) WHERE entry_id IS NOT NULL;
-- One open help request per lead.
CREATE UNIQUE INDEX IF NOT EXISTS lead_comments_one_open_help
  ON sales.lead_comments (lead_id) WHERE kind = 'help' AND resolved_at IS NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES sales.users (id),
  kind       text        NOT NULL,
  title      text        NOT NULL,
  body       text,
  link       text,
  actor_id   uuid        REFERENCES sales.users (id),
  lead_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CONSTRAINT notifications_kind_valid CHECK (kind IN (
    'transfer_requested', 'transfer_decided', 'lead_assigned', 'mention', 'help_requested',
    'help_resolved', 'comment', 'feedback', 'leave_cover'
  ))
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON sales.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON sales.notifications (user_id) WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- message_templates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.message_templates (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES sales.projects (id),
  label      text        NOT NULL,
  body       text        NOT NULL,
  sort       integer     NOT NULL DEFAULT 0,
  created_by uuid        NOT NULL REFERENCES sales.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT message_templates_label_length CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  CONSTRAINT message_templates_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS message_templates_project_sort_idx
  ON sales.message_templates (project_id, sort) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'message_templates_set_updated_at') THEN
    CREATE TRIGGER message_templates_set_updated_at BEFORE UPDATE ON sales.message_templates
      FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();
  END IF;
END $$;
