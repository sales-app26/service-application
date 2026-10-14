-- Reverses 09_training.sql. Every course, lesson, progress row, practice pitch and
-- certificate is dropped; training notifications are deleted.
DELETE FROM sales.notifications WHERE kind = 'training';
ALTER TABLE sales.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE sales.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'transfer_requested', 'transfer_decided', 'lead_assigned', 'mention', 'help_requested',
  'help_resolved', 'comment', 'feedback', 'leave_cover'
));
DROP TABLE IF EXISTS sales.training_certifications;
DROP TABLE IF EXISTS sales.roleplay_sessions;
DROP TABLE IF EXISTS sales.training_progress;
DROP TABLE IF EXISTS sales.project_courses;
DROP TABLE IF EXISTS sales.training_items;
DROP TABLE IF EXISTS sales.training_courses;
