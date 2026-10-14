-- Training: YouTube playlists and the App tutorial step.
--
--  - training_items.kind gains 'playlist': one YouTube playlist link; the app lists and plays
--    each video in it (the modules) in its own player.
--  - training_items.step gains 'tutorial' (App tutorial), where playlists show by default.
--  - training_progress.details: per-module progress inside a playlist,
--    { "watched": { "<youtubeId>": <percent> } }. Empty for every other kind.
--
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.training_items DROP CONSTRAINT IF EXISTS training_items_kind_valid;
ALTER TABLE sales.training_items ADD CONSTRAINT training_items_kind_valid
  CHECK (kind IN ('video', 'document', 'card', 'quiz', 'roleplay', 'playlist'));

ALTER TABLE sales.training_items DROP CONSTRAINT IF EXISTS training_items_step_valid;
ALTER TABLE sales.training_items ADD CONSTRAINT training_items_step_valid
  CHECK (step IN ('watch', 'tutorial', 'practise', 'prove', 'field', 'library'));

ALTER TABLE sales.training_progress
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
