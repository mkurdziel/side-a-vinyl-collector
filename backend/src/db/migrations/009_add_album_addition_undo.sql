CREATE TABLE IF NOT EXISTS album_addition_undo (
    collection_id INTEGER PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    token_digest TEXT NOT NULL,
    expected_status VARCHAR(20) NOT NULL,
    expected_catalog_listing JSONB,
    expected_artwork_provenance JSONB,
    previous_discogs_id INTEGER,
    previous_catalog_listing JSONB,
    expires_at TIMESTAMPTZ NOT NULL
);
