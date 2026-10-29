-- 0012_conversations.sql —— 按「对方+帖子」拆私信会话。
-- 有 post_id 的旧消息迁入 conversations；无帖私信无法归属，丢弃。
--
-- 上线注意:
-- - 远端 apply 前请备份 D1；本文件与「曾在本地跑过的清空版」不同，以仓库当前 SQL 为准。
-- - 仅对尚未标记为已应用 0012 的库执行；已应用过旧版清空迁移的环境库勿重复执行。

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  post_id TEXT NOT NULL,
  post_title TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER,
  created_at INTEGER,
  UNIQUE (user_a, user_b, post_id),
  FOREIGN KEY (user_a) REFERENCES users(id),
  FOREIGN KEY (user_b) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_a_last ON conversations(user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b_last ON conversations(user_b, last_message_at DESC);

-- 按「双方字典序 + post_id」建会话（id 用 hex(randomblob(16))）
INSERT OR IGNORE INTO conversations (id, user_a, user_b, post_id, post_title, last_message_at, created_at)
SELECT
  lower(hex(randomblob(16))),
  CASE WHEN sender_id < receiver_id THEN sender_id ELSE receiver_id END,
  CASE WHEN sender_id < receiver_id THEN receiver_id ELSE sender_id END,
  post_id,
  COALESCE((SELECT title FROM posts p WHERE p.id = m.post_id), ''),
  MAX(created_at),
  MIN(created_at)
FROM messages m
WHERE post_id IS NOT NULL AND TRIM(post_id) != ''
GROUP BY
  CASE WHEN sender_id < receiver_id THEN sender_id ELSE receiver_id END,
  CASE WHEN sender_id < receiver_id THEN receiver_id ELSE sender_id END,
  post_id;

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  post_id TEXT,
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id)
);

INSERT INTO messages_new (id, conversation_id, sender_id, receiver_id, post_id, content, read, created_at)
SELECT
  m.id,
  c.id,
  m.sender_id,
  m.receiver_id,
  m.post_id,
  m.content,
  m.read,
  m.created_at
FROM messages m
JOIN conversations c
  ON c.post_id = m.post_id
 AND c.user_a = CASE WHEN m.sender_id < m.receiver_id THEN m.sender_id ELSE m.receiver_id END
 AND c.user_b = CASE WHEN m.sender_id < m.receiver_id THEN m.receiver_id ELSE m.sender_id END
WHERE m.post_id IS NOT NULL AND TRIM(m.post_id) != '';

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, read);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
