-- Reverses 10_training_playlists.sql. Playlist lessons and their progress are deleted;
-- lessons under App tutorial move to Watch.
DELETE FROM sales.training_progress
 WHERE item_id IN (SELECT id FROM sales.training_items WHERE kind = 'playlist');
DELETE FROM sales.roleplay_sessions
 WHERE item_id IN (SELECT id FROM sales.training_items WHERE kind = 'playlist');
DELETE FROM sales.training_items WHERE kind = 'playlist';
UPDATE sales.training_items SET step = 'watch' WHERE step = 'tutorial';

ALTER TABLE sales.training_progress DROP COLUMN IF EXISTS details;
ALTER TABLE sales.training_items DROP CONSTRAINT IF EXISTS training_items_step_valid;
ALTER TABLE sales.training_items ADD CONSTRAINT training_items_step_valid
  CHECK (step IN ('watch', 'practise', 'prove', 'field', 'library'));
ALTER TABLE sales.training_items DROP CONSTRAINT IF EXISTS training_items_kind_valid;
ALTER TABLE sales.training_items ADD CONSTRAINT training_items_kind_valid
  CHECK (kind IN ('video', 'document', 'card', 'quiz', 'roleplay'));
