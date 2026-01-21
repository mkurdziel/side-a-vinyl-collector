-- Add MusicBrainz ID to albums table
ALTER TABLE albums ADD COLUMN IF NOT EXISTS musicbrainz_id UUID;
CREATE INDEX IF NOT EXISTS idx_albums_musicbrainz ON albums(musicbrainz_id);

-- Add local cover art path for albums without official art from MusicBrainz
ALTER TABLE albums ADD COLUMN IF NOT EXISTS local_cover_path TEXT;

-- Add column to track if we've attempted to fetch MusicBrainz cover art
ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_art_fetched BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN albums.musicbrainz_id IS 'MusicBrainz Release ID (MBID)';
COMMENT ON COLUMN albums.local_cover_path IS 'Local file path for cached cover art (for albums without official MusicBrainz art)';
COMMENT ON COLUMN albums.cover_art_fetched IS 'Whether we have attempted to fetch cover art from MusicBrainz';
