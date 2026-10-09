-- =============================================================================
-- Sales Tracker — schema v1 (DB Design, 8 October 2026)
--
-- Seven tables: users, projects, project_members, locations, leads, follow_ups,
-- lead_transfers. This file, not the TypeORM entities, is the source of truth.
--
-- The database enforces what can be checked from a single row or a unique
-- index (DB Design §3): allowed values, uniqueness, one pending transfer per
-- lead, target number and period set together, a conversion that always has a
-- time and a person. Everything that depends on role, project type or the time
-- of day is enforced by the API.
--
-- All times are timestamptz (stored UTC). "Today", weeks and months are India
-- time, applied by the API.
--
-- Everything lives in the `sales` schema, never `public`: the Supabase project
-- is shared, and `public` is the schema PostgREST exposes by default. Every
-- name is schema-qualified so the file runs the same from the SQL editor, a
-- migration, or a connection with any search_path.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS sales;

-- Keeps updated_at honest for writes that bypass the ORM (SQL editor, scripts).
CREATE OR REPLACE FUNCTION sales.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- users — one row per person, whatever their role. id = Supabase auth.users.id
-- -----------------------------------------------------------------------------
CREATE TABLE sales.users (
  id          uuid        PRIMARY KEY,
  name        text        NOT NULL,
  email       text        NOT NULL,
  phone       text,
  role        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES sales.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_name_present   CHECK (length(btrim(name)) > 0),
  CONSTRAINT users_email_lowercase CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  CONSTRAINT users_phone_format   CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT users_role_valid     CHECK (role IN ('super_admin', 'moderator', 'sales_person'))
);

CREATE UNIQUE INDEX users_email_key ON sales.users (email);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON sales.users
  FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
CREATE TABLE sales.projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  image_path  text,
  type        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'active',
  start_date  date        NOT NULL,
  end_date    date,
  closed_at   timestamptz,
  created_by  uuid        NOT NULL REFERENCES sales.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_name_present    CHECK (length(btrim(name)) > 0),
  CONSTRAINT projects_type_valid      CHECK (type IN ('online', 'door_to_door')),
  CONSTRAINT projects_status_valid    CHECK (status IN ('active', 'closed')),
  CONSTRAINT projects_end_after_start CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT projects_closed_at_matches_status
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX projects_status_idx ON sales.projects (status);

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON sales.projects
  FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();

-- -----------------------------------------------------------------------------
-- project_members — one user in one project, with that person's target
-- -----------------------------------------------------------------------------
CREATE TABLE sales.project_members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL REFERENCES sales.projects (id),
  user_id       uuid        NOT NULL REFERENCES sales.users (id),
  target_count  integer,
  target_period text,
  is_active     boolean     NOT NULL DEFAULT true,
  assigned_by   uuid        REFERENCES sales.users (id),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz,
  CONSTRAINT project_members_project_user_key UNIQUE (project_id, user_id),
  CONSTRAINT project_members_target_period_valid
    CHECK (target_period IS NULL OR target_period IN ('weekly', 'monthly')),
  -- Number and period are set together; the number is at least 1.
  CONSTRAINT project_members_target_pair CHECK (
    (target_count IS NULL AND target_period IS NULL)
    OR (target_count IS NOT NULL AND target_period IS NOT NULL AND target_count >= 1)
  ),
  CONSTRAINT project_members_removed_at_matches_active
    CHECK (is_active = (removed_at IS NULL))
);

CREATE INDEX project_members_user_active_idx ON sales.project_members (user_id) WHERE is_active;
CREATE INDEX project_members_project_active_idx ON sales.project_members (project_id) WHERE is_active;

-- -----------------------------------------------------------------------------
-- locations — the list behind the per-project autocomplete
-- -----------------------------------------------------------------------------
CREATE TABLE sales.locations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES sales.projects (id),
  name       text        NOT NULL,
  created_by uuid        REFERENCES sales.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_name_length CHECK (char_length(name) BETWEEN 2 AND 100 AND name = btrim(name)),
  -- Lets leads and follow-ups prove their location is from the same project.
  CONSTRAINT locations_id_project_key UNIQUE (id, project_id)
);

-- "Wanowrie" and "wanowrie" are one place; the first spelling saved is kept.
CREATE UNIQUE INDEX locations_project_name_key ON sales.locations (project_id, lower(name));

-- -----------------------------------------------------------------------------
-- leads — the current state of one client in one project
-- -----------------------------------------------------------------------------
CREATE TABLE sales.leads (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid        NOT NULL REFERENCES sales.projects (id),
  owner_id            uuid        NOT NULL REFERENCES sales.users (id),
  name                text        NOT NULL,
  business_name       text,
  phone               text        NOT NULL,
  location_id         uuid        NOT NULL,
  notes               text,
  status              text        NOT NULL DEFAULT 'new',
  next_follow_up_date date,
  converted_at        timestamptz,
  converted_by        uuid        REFERENCES sales.users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT leads_name_present  CHECK (length(btrim(name)) > 0),
  CONSTRAINT leads_phone_format  CHECK (phone ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT leads_status_valid  CHECK (status IN (
    'new', 'contacted', 'interested', 'follow_up_scheduled', 'not_interested', 'converted', 'lost'
  )),
  -- A conversion always has a time and a person, and only a converted lead has one.
  CONSTRAINT leads_conversion_consistent CHECK (
    (status = 'converted' AND converted_at IS NOT NULL AND converted_by IS NOT NULL)
    OR (status <> 'converted' AND converted_at IS NULL AND converted_by IS NULL)
  ),
  -- Closed statuses never carry a next follow-up date (PRD §4).
  CONSTRAINT leads_no_next_date_when_closed CHECK (
    next_follow_up_date IS NULL OR status NOT IN ('not_interested', 'converted', 'lost')
  ),
  CONSTRAINT leads_id_project_key UNIQUE (id, project_id),
  CONSTRAINT leads_location_same_project
    FOREIGN KEY (location_id, project_id) REFERENCES sales.locations (id, project_id)
);

-- No duplicate phone in a project; a deleted lead frees its number.
CREATE UNIQUE INDEX leads_project_phone_key ON sales.leads (project_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX leads_owner_next_follow_up_idx ON sales.leads (owner_id, next_follow_up_date) WHERE deleted_at IS NULL;
CREATE INDEX leads_project_status_idx ON sales.leads (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX leads_project_converted_idx ON sales.leads (project_id, converted_by, converted_at) WHERE deleted_at IS NULL;
CREATE INDEX leads_project_created_idx ON sales.leads (project_id, created_at) WHERE deleted_at IS NULL;

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON sales.leads
  FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();

-- -----------------------------------------------------------------------------
-- follow_ups — one row per contact, visit or manual status change
-- -----------------------------------------------------------------------------
CREATE TABLE sales.follow_ups (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid          NOT NULL,
  project_id          uuid          NOT NULL,
  user_id             uuid          NOT NULL REFERENCES sales.users (id),
  entry_type          text          NOT NULL,
  status              text          NOT NULL,
  note                text,
  next_follow_up_date date,
  location_id         uuid,
  photo_path          text,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  gps_accuracy_m      numeric(10, 2),
  client_request_id   uuid,
  -- Server time. The official visit time; the phone never sends it.
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT follow_ups_entry_type_valid CHECK (entry_type IN ('follow_up', 'status_change')),
  CONSTRAINT follow_ups_status_valid CHECK (status IN (
    'new', 'contacted', 'interested', 'follow_up_scheduled', 'not_interested', 'converted', 'lost'
  )),
  CONSTRAINT follow_ups_latitude_range  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT follow_ups_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT follow_ups_accuracy_non_negative CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m >= 0),
  -- Visit proof is all or nothing: one photo with its position and accuracy.
  CONSTRAINT follow_ups_visit_proof_complete CHECK (
    (photo_path IS NULL AND latitude IS NULL AND longitude IS NULL AND gps_accuracy_m IS NULL)
    OR (photo_path IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL AND gps_accuracy_m IS NOT NULL)
  ),
  -- A manual status change is not a visit and never carries proof.
  CONSTRAINT follow_ups_status_change_has_no_proof
    CHECK (entry_type = 'follow_up' OR photo_path IS NULL),
  CONSTRAINT follow_ups_lead_same_project
    FOREIGN KEY (lead_id, project_id) REFERENCES sales.leads (id, project_id),
  CONSTRAINT follow_ups_location_same_project
    FOREIGN KEY (location_id, project_id) REFERENCES sales.locations (id, project_id),
  -- Stops a double tap or a retry from saving the same entry twice.
  CONSTRAINT follow_ups_client_request_id_key UNIQUE (client_request_id)
);

CREATE INDEX follow_ups_project_created_idx ON sales.follow_ups (project_id, created_at);
CREATE INDEX follow_ups_user_created_idx ON sales.follow_ups (user_id, created_at);
CREATE INDEX follow_ups_lead_created_idx ON sales.follow_ups (lead_id, created_at);
CREATE INDEX follow_ups_location_idx ON sales.follow_ups (location_id) WHERE location_id IS NOT NULL;

CREATE TRIGGER follow_ups_set_updated_at BEFORE UPDATE ON sales.follow_ups
  FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();

-- -----------------------------------------------------------------------------
-- lead_transfers — requests to hand a lead to another member
-- -----------------------------------------------------------------------------
CREATE TABLE sales.lead_transfers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid        NOT NULL REFERENCES sales.leads (id),
  from_user_id  uuid        NOT NULL REFERENCES sales.users (id),
  to_user_id    uuid        NOT NULL REFERENCES sales.users (id),
  reason        text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  requested_by  uuid        NOT NULL REFERENCES sales.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid        REFERENCES sales.users (id),
  decided_at    timestamptz,
  -- Why it was decided — set on every rejection the system makes on someone's
  -- behalf ("User deactivated", "Project closed") and optional otherwise.
  decision_note text,
  CONSTRAINT lead_transfers_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT lead_transfers_reason_present CHECK (length(btrim(reason)) > 0),
  CONSTRAINT lead_transfers_distinct_users CHECK (from_user_id <> to_user_id),
  CONSTRAINT lead_transfers_decision_consistent CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

-- One open transfer per lead.
CREATE UNIQUE INDEX lead_transfers_one_pending_per_lead ON sales.lead_transfers (lead_id) WHERE status = 'pending';
CREATE INDEX lead_transfers_lead_status_idx ON sales.lead_transfers (lead_id, status);
CREATE INDEX lead_transfers_pending_idx ON sales.lead_transfers (created_at) WHERE status = 'pending';
