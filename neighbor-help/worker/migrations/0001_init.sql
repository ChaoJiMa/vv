-- 0001_init.sql —— 初始表结构 + 索引
-- 对应 schema.sql 的完整建表。新库执行 `wrangler d1 migrations apply` 时按编号顺序应用。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,           -- 用户名密码登录用(可空,微信用户没有)
  password TEXT,                  -- PBKDF2 哈希,绝不存明文
  openid TEXT UNIQUE,             -- 微信登录用(可空)
  nickname TEXT,
  avatar TEXT,
  building TEXT,
  unit TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  images TEXT,
  status TEXT DEFAULT 'open',
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 列表查询:按 type 筛选 + 按 created_at 倒序;全部列表也走 created_at
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type_created_at ON posts(type, created_at DESC);
-- 详情页加载某帖的评论
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
