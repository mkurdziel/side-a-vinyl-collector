CREATE TABLE IF NOT EXISTS album_removal_undo (
    album_id INTEGER PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL,
    status VARCHAR(20),
    notes TEXT,
    added_at TIMESTAMP,
    token_digest TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_album_removal_undo_expires ON album_removal_undo(expires_at);
