-- Quote posts: a post can embed/quote another post (Twitter-style quote-tweet)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS quoted_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_posts_quoted ON posts(quoted_post_id);
