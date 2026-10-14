-- Training inside every campaign (TRAINING-PLAN.md).
--
--  - training_courses: a course in the company library ("Frostique: core sales training"),
--    built once by the sales head and attached to any number of campaigns.
--  - training_items: one lesson. It belongs to a course, or to one campaign only
--    (a city briefing, a local offer): exactly one of course_id / project_id.
--      kind    video (a YouTube link), document (a PDF or image in our storage, or a link),
--              card (short text for the field kit), quiz, roleplay (practise with an AI owner)
--      step    watch, practise, prove, field, library — where the lesson shows for a rep
--      payload what the kind needs (video id and checks, quiz questions, the role-play
--              persona and rubric…). Shapes are checked by the API (training-rules.ts).
--  - project_courses: which library courses a campaign uses, in order.
--  - training_progress: one row per person per lesson: how far, done, best score, and the
--    tries made on the day of last_attempt_at (quizzes allow a few a day).
--  - roleplay_sessions: one practice pitch: the conversation, its score and feedback.
--  - training_certifications: the day a person finished every required lesson of a campaign.
--  - notifications.kind gains 'training'.
--
-- Idempotent, so a database where it was applied by hand is left as it is.

CREATE TABLE IF NOT EXISTS sales.training_courses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  description text,
  published   boolean     NOT NULL DEFAULT false,
  created_by  uuid        NOT NULL REFERENCES sales.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT training_courses_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT training_courses_description_length
    CHECK (description IS NULL OR char_length(description) <= 2000)
);

CREATE TABLE IF NOT EXISTS sales.training_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid        REFERENCES sales.training_courses (id),
  project_id uuid        REFERENCES sales.projects (id),
  step       text        NOT NULL,
  kind       text        NOT NULL,
  title      text        NOT NULL,
  summary    text,
  sort       integer     NOT NULL DEFAULT 0,
  required   boolean     NOT NULL DEFAULT true,
  minutes    smallint,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  file_path  text,
  created_by uuid        NOT NULL REFERENCES sales.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT training_items_one_owner CHECK ((course_id IS NULL) <> (project_id IS NULL)),
  CONSTRAINT training_items_kind_valid
    CHECK (kind IN ('video', 'document', 'card', 'quiz', 'roleplay')),
  CONSTRAINT training_items_step_valid
    CHECK (step IN ('watch', 'practise', 'prove', 'field', 'library')),
  CONSTRAINT training_items_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT training_items_summary_length CHECK (summary IS NULL OR char_length(summary) <= 500),
  CONSTRAINT training_items_minutes_range CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 240),
  CONSTRAINT training_items_sort_range CHECK (sort BETWEEN 0 AND 10000),
  CONSTRAINT training_items_file_only_documents CHECK (file_path IS NULL OR kind = 'document')
);

CREATE INDEX IF NOT EXISTS training_items_course_sort_idx
  ON sales.training_items (course_id, sort) WHERE deleted_at IS NULL AND course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_items_project_sort_idx
  ON sales.training_items (project_id, sort) WHERE deleted_at IS NULL AND project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales.project_courses (
  project_id uuid        NOT NULL REFERENCES sales.projects (id),
  course_id  uuid        NOT NULL REFERENCES sales.training_courses (id),
  sort       integer     NOT NULL DEFAULT 0,
  created_by uuid        NOT NULL REFERENCES sales.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, course_id)
);

CREATE TABLE IF NOT EXISTS sales.training_progress (
  user_id          uuid        NOT NULL REFERENCES sales.users (id),
  item_id          uuid        NOT NULL REFERENCES sales.training_items (id),
  percent          smallint    NOT NULL DEFAULT 0,
  position_seconds integer,
  best_score       smallint,
  attempts         integer     NOT NULL DEFAULT 0,
  day_attempts     smallint    NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT training_progress_percent_range CHECK (percent BETWEEN 0 AND 100),
  CONSTRAINT training_progress_score_range CHECK (best_score IS NULL OR best_score BETWEEN 0 AND 100),
  CONSTRAINT training_progress_position_range CHECK (position_seconds IS NULL OR position_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS training_progress_item_idx ON sales.training_progress (item_id);

CREATE TABLE IF NOT EXISTS sales.roleplay_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES sales.users (id),
  item_id     uuid        NOT NULL REFERENCES sales.training_items (id),
  project_id  uuid        NOT NULL REFERENCES sales.projects (id),
  transcript  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  rep_turns   smallint    NOT NULL DEFAULT 0,
  score       smallint,
  feedback    jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT roleplay_sessions_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CONSTRAINT roleplay_sessions_scored_when_finished
    CHECK (score IS NULL OR finished_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS roleplay_sessions_user_started_idx
  ON sales.roleplay_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS roleplay_sessions_project_idx
  ON sales.roleplay_sessions (project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sales.training_certifications (
  user_id      uuid        NOT NULL REFERENCES sales.users (id),
  project_id   uuid        NOT NULL REFERENCES sales.projects (id),
  certified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'training_courses_set_updated_at') THEN
    CREATE TRIGGER training_courses_set_updated_at BEFORE UPDATE ON sales.training_courses
      FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'training_items_set_updated_at') THEN
    CREATE TRIGGER training_items_set_updated_at BEFORE UPDATE ON sales.training_items
      FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'training_progress_set_updated_at') THEN
    CREATE TRIGGER training_progress_set_updated_at BEFORE UPDATE ON sales.training_progress
      FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();
  END IF;
END $$;

-- Notifications about training: a rep certified (to the campaign's managers).
ALTER TABLE sales.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE sales.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'transfer_requested', 'transfer_decided', 'lead_assigned', 'mention', 'help_requested',
  'help_resolved', 'comment', 'feedback', 'leave_cover', 'training'
));
