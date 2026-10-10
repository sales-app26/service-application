-- Reverses 02_app_versions.sql. Drops every release note and the read log.
DROP TABLE IF EXISTS sales.app_version_views;
DROP TABLE IF EXISTS sales.app_versions;
