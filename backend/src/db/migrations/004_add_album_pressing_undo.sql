CREATE TABLE IF NOT EXISTS album_pressing_undo (
    collection_id INTEGER PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    token_digest TEXT NOT NULL,
    expected_discogs_id INTEGER NOT NULL,
    previous_discogs_id INTEGER,
    previous_catalog_listing JSONB,
    expires_at TIMESTAMPTZ NOT NULL
);
