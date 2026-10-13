-- Visit place: where a visit photo was taken, in words.
--
--  - follow_ups.place_name: the place looked up from OpenStreetMap when the visit
--    was saved, e.g. 'Wanowrie Road, Wanowrie, Pune 411040'. It is also burnt onto
--    the photo. NULL on online follow-ups, on visits saved before this, and when the
--    lookup found nothing or was too slow — a visit never waits on it.
--
-- Idempotent, so a database where it was applied by hand is left as it is.
ALTER TABLE sales.follow_ups ADD COLUMN IF NOT EXISTS place_name text;

DO $$
BEGIN
  -- Short and never blank.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_place_name_length') THEN
    ALTER TABLE sales.follow_ups
      ADD CONSTRAINT follow_ups_place_name_length
      CHECK (place_name IS NULL OR char_length(btrim(place_name)) BETWEEN 1 AND 200);
  END IF;
  -- A place only proves something next to the photo it was stamped on.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_place_needs_photo') THEN
    ALTER TABLE sales.follow_ups
      ADD CONSTRAINT follow_ups_place_needs_photo
      CHECK (place_name IS NULL OR photo_path IS NOT NULL);
  END IF;
END $$;
