-- 举报:用户对帖子或评论发起举报,沉淀待人工复核(本期无管理后台,先存表)。
-- target_type 取 'post' / 'comment';target_id 为对应 id。
-- 同一用户对同一目标只记一次(UNIQUE),重复举报被忽略,避免刷量。
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,            -- UUID
  reporter_id TEXT NOT NULL,      -- 举报人
  target_type TEXT NOT NULL,      -- 'post' / 'comment'
  target_id TEXT NOT NULL,        -- 被举报的帖子/评论 id
  reason TEXT,                    -- 举报理由(可选,枚举或自由文本)
  status TEXT DEFAULT 'pending',  -- pending / reviewed / dismissed(预留给后续后台)
  created_at INTEGER,             -- 毫秒时间戳
  UNIQUE (reporter_id, target_type, target_id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);
-- 复核台按状态 + 时间倒序拉取
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);
