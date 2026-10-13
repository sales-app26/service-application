-- Reverses 07_visit_place.sql. Visits keep their photos (the place stays burnt
-- onto them) but lose the stored place name.
ALTER TABLE sales.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_place_needs_photo;
ALTER TABLE sales.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_place_name_length;
ALTER TABLE sales.follow_ups DROP COLUMN IF EXISTS place_name;
