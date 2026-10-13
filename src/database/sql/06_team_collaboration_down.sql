-- Reverses 06_team_collaboration.sql. Leaves, backups, comments, notifications and
-- message templates are dropped; entries a backup logged keep their author but lose
-- who they were covering for.
DROP TABLE IF EXISTS sales.message_templates;
DROP TABLE IF EXISTS sales.notifications;
DROP TABLE IF EXISTS sales.lead_comments;
ALTER TABLE sales.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_covering_not_self;
ALTER TABLE sales.follow_ups DROP COLUMN IF EXISTS covering_for_id;
ALTER TABLE sales.project_members DROP CONSTRAINT IF EXISTS project_members_backup_not_self;
ALTER TABLE sales.project_members DROP COLUMN IF EXISTS backup_user_id;
DROP TABLE IF EXISTS sales.user_leaves;
