-- Add status column to collections table
ALTER TABLE collections ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'collection';

-- Index for faster filtering by status
CREATE INDEX IF NOT EXISTS idx_collections_status ON collections(status);
