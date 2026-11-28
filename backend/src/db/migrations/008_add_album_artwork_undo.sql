CREATE TABLE IF NOT EXISTS album_artwork_undo (
    collection_id INTEGER PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    token_digest TEXT NOT NULL,
    previous_artwork JSONB NOT NULL,
    applied_artwork JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
