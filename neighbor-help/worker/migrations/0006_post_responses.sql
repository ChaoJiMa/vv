-- 0006_post_responses.sql —— 帖子响应(报名)表
-- 用户对 求助/闲置/失物 帖子点「我要帮忙 / 我想要 / 这是我的」即记一条响应。
-- 同一用户对同一帖只记一次(UNIQUE)。完成时发帖人从响应者中采纳。
CREATE TABLE IF NOT EXISTS post_responses (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  UNIQUE (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
-- 列某帖的响应者 / 判断我是否已响应
CREATE INDEX IF NOT EXISTS idx_post_responses_post ON post_responses(post_id);
