-- Add pinned post support
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Index for fast pinned post lookup
CREATE INDEX IF NOT EXISTS idx_posts_is_pinned ON posts (is_pinned) WHERE is_pinned = TRUE;
