-- ⚠️ 本文件是完整表结构的「参考快照」,仅供查阅与全新环境一次性建库。
--    生产/开发的真实建表与变更以 migrations/ 下的增量迁移为准
--    (用 `npx wrangler d1 migrations apply` 执行)。改表结构时请同时更新这里与 migrations/,
--    避免两者漂移。
-- 主键全部用 UUID(TEXT),由应用层 crypto.randomUUID() 生成,不暴露递增规律。
-- created_at 统一为毫秒时间戳(INTEGER),由应用层 Date.now() 填充,与 JWT exp 口径一致。
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- UUID,应用层生成
  username TEXT UNIQUE,           -- 用户名密码登录用(可空,微信用户没有)
  password TEXT,                  -- PBKDF2 哈希,绝不存明文
  openid TEXT UNIQUE,             -- 微信登录用(可空)
  nickname TEXT,
  avatar TEXT,
  building TEXT,
  unit TEXT,
  created_at INTEGER,            -- 毫秒时间戳,Date.now()
  token_version INTEGER DEFAULT 0  -- token 吊销版本:改密码/退出登录时 +1,使旧 token 立即失效
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,           -- UUID
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  images TEXT,
  status TEXT DEFAULT 'open',
  contact TEXT,                  -- 联系方式(可空),发布页填写
  location TEXT,                 -- 帖子位置(可空),默认带入发帖人楼栋单元,可改
  created_at INTEGER,           -- 毫秒时间戳
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,          -- UUID
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER,          -- 毫秒时间戳
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 列表查询:按 type 筛选 + 按 created_at 倒序;全部列表也走 created_at
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type_created_at ON posts(type, created_at DESC);
-- 详情页加载某帖的评论
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

-- 限流计数(固定窗口):登录/注册防暴力破解
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,         -- 如 login:<ip>
  window_start INTEGER,         -- 窗口起点毫秒时间戳
  count INTEGER DEFAULT 0
);

-- 私信:两用户之间的点对点消息。post_id 记录从哪条帖子发起的私信(可空)。
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,           -- UUID
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  post_id TEXT,                  -- 来源帖子(从「私信 TA」进来时记录),可空
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,        -- 0 未读 / 1 已读(接收方拉取会话时置 1)
  created_at INTEGER,            -- 毫秒时间戳
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id)
);

-- 通知:type 取 'comment'(评论回复)/ 'respond'(有人响应)/ 'adopt'(被采纳)/ 'thank'(被采纳并感谢)。
-- actor_id 为触发者(评论人/响应人/帖主),user_id 为接收者。content 冗余:评论为评论内容,其余为帖子标题。
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,           -- UUID
  user_id TEXT NOT NULL,         -- 接收通知的用户(帖子作者)
  type TEXT NOT NULL,            -- 通知类型,如 'comment'
  post_id TEXT,                  -- 关联帖子
  actor_id TEXT,                 -- 触发者(评论人)
  content TEXT,                  -- 冗余存评论内容,列表直接展示
  read INTEGER DEFAULT 0,
  created_at INTEGER,            -- 毫秒时间戳
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 会话拉取:两人之间按时间取消息
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, created_at);
-- 未读私信计数(首页角标)
CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, read);
-- 消息列表 / 未读通知计数
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

-- 采纳记录:帖子完成时,发帖人采纳哪些"帮助者"(可多人)。
-- thanked=1 表示额外感谢(会给被采纳者发通知);0 仅采纳(计入统计但不通知)。
-- 个人页统计据此计算:helper_id 出现次数=他"帮助了"几次;某人帖子里的采纳条数=他"获得帮助"几次。
CREATE TABLE IF NOT EXISTS post_helpers (
  id TEXT PRIMARY KEY,           -- UUID
  post_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,       -- 被采纳的帮助者
  thanked INTEGER DEFAULT 0,     -- 0 仅采纳 / 1 采纳并感谢
  created_at INTEGER,            -- 毫秒时间戳
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (helper_id) REFERENCES users(id)
);
-- 「帮助了」统计:某用户被采纳的总次数
CREATE INDEX IF NOT EXISTS idx_post_helpers_helper ON post_helpers(helper_id);
-- 某帖已采纳的帮助者(详情页展示 / 防重复采纳)
CREATE INDEX IF NOT EXISTS idx_post_helpers_post ON post_helpers(post_id);

-- 帖子响应(报名):用户对 求助/闲置/失物 帖点「我要帮忙 / 我想要 / 这是我的」记一条。
-- 同一用户对同一帖只记一次。完成时发帖人从响应者里采纳(post_helpers)。
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

-- 举报:用户对帖子或评论发起举报,沉淀待人工复核(本期无管理后台,先存表)。
-- target_type 取 'post' / 'comment';同一用户对同一目标只记一次(UNIQUE)。
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,           -- UUID
  reporter_id TEXT NOT NULL,     -- 举报人
  target_type TEXT NOT NULL,     -- 'post' / 'comment'
  target_id TEXT NOT NULL,       -- 被举报的帖子/评论 id
  reason TEXT,                   -- 举报理由(可选)
  status TEXT DEFAULT 'pending', -- pending / reviewed / dismissed(预留给后续后台)
  created_at INTEGER,            -- 毫秒时间戳
  UNIQUE (reporter_id, target_type, target_id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);

-- 应用配置:把原先写死在代码里的「小区结构」与「敏感词表」移入 D1,运营可直接 UPDATE 调整。
-- value 统一存 JSON 字符串(小区为对象、敏感词为数组),应用层 JSON.parse 读取并带 60s 内存缓存。
-- 见 src/config.js(community)与 src/sensitive.js(sensitive_words)。种子数据见 migrations/0008_app_config.sql。
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,          -- 'community' / 'sensitive_words'
  value TEXT                     -- JSON 字符串
);
