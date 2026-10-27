-- 0010_announcements_admin.sql —— 用户角色 + 滚动公告表
-- notices 从 app_config.announcements.notices 一次性导入;safetyTips 仍留在配置。
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_announcements_enabled_sort
  ON announcements(enabled, sort DESC, updated_at DESC);

UPDATE users SET role = 'admin' WHERE username = 'admin';

-- 从 app_config 导入 notices(仅当公告表为空且配置存在时)
INSERT INTO announcements (id, content, sort, enabled, created_at, updated_at)
SELECT
  printf('seed-%03d', je.key),
  je.value,
  (1000 - CAST(je.key AS INTEGER)),
  1,
  1760000000000,
  1760000000000
FROM app_config ac, json_each(json_extract(ac.value, '$.notices')) AS je
WHERE ac.key = 'announcements'
  AND NOT EXISTS (SELECT 1 FROM announcements LIMIT 1);
