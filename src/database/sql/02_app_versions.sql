-- =============================================================================
-- Sales Tracker — release notes (version management)
--
-- Two tables in the `sales` schema: app_versions (a release and its note) and
-- app_version_views (who has been shown which note).
--
-- Applies on top of 01_sales_schema.sql and is safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales.app_versions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version      text        NOT NULL,
  -- major*1_000_000 + minor*1_000 + patch, written by the API. "Latest" cannot be a
  -- string comparison (1.10.0 sorts below 1.9.0) or the release date (a patch for an
  -- older line can be dated after a newer release).
  sort_order   integer     NOT NULL,
  title        text,
  tags         text[]      NOT NULL DEFAULT '{}',
  notes        text        NOT NULL DEFAULT '',
  released_at  timestamptz NOT NULL DEFAULT now(),
  is_published boolean     NOT NULL DEFAULT false,
  -- Whether reaching this version raises the "What's new" dialog.
  notify       boolean     NOT NULL DEFAULT true,
  created_by   uuid        REFERENCES sales.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_versions_version_format CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT app_versions_sort_order_positive CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_versions_version_key ON sales.app_versions (version);
CREATE INDEX IF NOT EXISTS idx_app_versions_sort ON sales.app_versions (sort_order DESC);

DROP TRIGGER IF EXISTS app_versions_set_updated_at ON sales.app_versions;
CREATE TRIGGER app_versions_set_updated_at BEFORE UPDATE ON sales.app_versions
  FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();

-- A table, not browser storage: the same person opens the tracker on a phone and a
-- laptop, and storage would raise the dialog again on each and forget it when cleared.
CREATE TABLE IF NOT EXISTS sales.app_version_views (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid        NOT NULL REFERENCES sales.app_versions (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES sales.users (id) ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_version_views_version_user_key
  ON sales.app_version_views (version_id, user_id);
CREATE INDEX IF NOT EXISTS idx_app_version_views_user ON sales.app_version_views (user_id);

-- 1.0.0 is the release everyone is already on, so it is seeded quiet: announcing it
-- would greet every existing user with a dialog about the app they already use.
INSERT INTO sales.app_versions (version, sort_order, title, notes, is_published, notify)
VALUES ('1.0.0', 1000000, 'First release',
        'The first release of Sales Tracker: leads, follow-ups, door-to-door visit proof, transfers and conversion targets.',
        true, false)
ON CONFLICT (version) DO NOTHING;
