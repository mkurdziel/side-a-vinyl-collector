-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Artists table
CREATE TABLE IF NOT EXISTS artists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    discogs_id INTEGER UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Albums table
CREATE TABLE IF NOT EXISTS albums (
    id SERIAL PRIMARY KEY,
    artist_id INTEGER REFERENCES artists(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    year INTEGER,
    cover_image_url TEXT,
    discogs_id INTEGER UNIQUE,
    musicbrainz_id UUID,
    local_cover_path TEXT,
    cover_art_fetched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(artist_id, title)
);

-- User collections (single-user MVP)
CREATE TABLE IF NOT EXISTS collections (
    id SERIAL PRIMARY KEY,
    album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT NOW(),
    notes TEXT,
    UNIQUE(album_id)
);

-- Barcode mappings
CREATE TABLE IF NOT EXISTS barcodes (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(50) UNIQUE NOT NULL,
    album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_discogs ON albums(discogs_id);
CREATE INDEX IF NOT EXISTS idx_albums_musicbrainz ON albums(musicbrainz_id);
CREATE INDEX IF NOT EXISTS idx_barcodes_code ON barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_collections_album ON collections(album_id);

-- GIN indexes for full-text search with trigrams
CREATE INDEX IF NOT EXISTS idx_artists_name_gin ON artists USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_albums_title_gin ON albums USING gin(title gin_trgm_ops);
