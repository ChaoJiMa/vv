-- 0002_uuid_ms.sql —— 主键改 UUID(TEXT)、created_at 改毫秒时间戳(INTEGER)
-- 破坏性变更:SQLite 无法直接改主键类型,且现有为测试数据,故 DROP 重建。
-- 重建后 id 由应用层 crypto.randomUUID() 写入,created_at 由 Date.now() 写入。

DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  password TEXT,
  openid TEXT UNIQUE,
  nickname TEXT,
  avatar TEXT,
  building TEXT,
  unit TEXT,
  created_at INTEGER,
  token_version INTEGER DEFAULT 0
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  images TEXT,
  status TEXT DEFAULT 'open',
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_type_created_at ON posts(type, created_at DESC);
CREATE INDEX idx_comments_post_id ON comments(post_id);
