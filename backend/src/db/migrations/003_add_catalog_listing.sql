-- Preserve album-level sources separately from an identified Discogs release.
ALTER TABLE albums ADD COLUMN IF NOT EXISTS catalog_listing JSONB;
