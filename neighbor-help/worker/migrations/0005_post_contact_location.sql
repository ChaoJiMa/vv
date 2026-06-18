-- 0005_post_contact_location.sql —— 帖子增加 联系方式 contact + 位置 location;新增采纳表 post_helpers
-- 均可空(老帖子为 NULL)。location 发帖时默认带入发帖人资料的楼栋单元,可手动改;
-- contact 由用户在发布页填写(资料暂未存联系方式,故默认空)。
ALTER TABLE posts ADD COLUMN contact TEXT;
ALTER TABLE posts ADD COLUMN location TEXT;

-- 采纳记录:帖子完成时,发帖人采纳哪些"帮助者"(可多人)。
-- thanked=1 表示额外感谢(给被采纳者发通知);0 仅采纳。
CREATE TABLE IF NOT EXISTS post_helpers (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  thanked INTEGER DEFAULT 0,
  created_at INTEGER,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (helper_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_post_helpers_helper ON post_helpers(helper_id);
CREATE INDEX IF NOT EXISTS idx_post_helpers_post ON post_helpers(post_id);
