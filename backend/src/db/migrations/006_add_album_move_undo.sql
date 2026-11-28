CREATE TABLE IF NOT EXISTS album_move_undo (
    collection_id INTEGER PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    token_digest TEXT NOT NULL,
    expected_status VARCHAR(20) NOT NULL,
    previous_status VARCHAR(20) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
