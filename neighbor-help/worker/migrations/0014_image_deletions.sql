-- Persistent deletion claims fence in-flight post/avatar writes against R2 cleanup.
CREATE TABLE IF NOT EXISTS image_deletions (
  image_key TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);
