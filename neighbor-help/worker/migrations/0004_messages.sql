-- 0004_messages.sql —— 私信 messages + 通知 notifications
-- 主键沿用 UUID(TEXT),created_at 为毫秒时间戳。

-- 私信:两人之间一条条消息。post_id 可空,表示从某帖发起的对话(便于展示来源)。
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  post_id TEXT,                  -- 可空:从帖子发起私信时记录来源帖
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,        -- 0 未读 / 1 已读(对 receiver 而言)
  created_at INTEGER,
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id)
);
-- 收件人未读统计 / 拉取某人收到的消息
CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, read);
-- 拉取两人之间的会话(双向),按时间排序
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, created_at);

-- 通知:目前仅"我的帖子被评论"。type 预留以便日后扩展(comment/...)。
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,         -- 通知的接收者(帖子作者)
  type TEXT NOT NULL,            -- 'comment'
  post_id TEXT,
  actor_id TEXT,                 -- 触发者(评论人)
  content TEXT,                  -- 冗余文案(如评论摘要),免再 JOIN
  read INTEGER DEFAULT 0,
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
-- 收件人未读统计 / 通知列表
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
