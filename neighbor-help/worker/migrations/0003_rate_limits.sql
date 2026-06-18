-- 0003_rate_limits.sql —— 限流计数表(登录/注册防暴力破解)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER,
  count INTEGER DEFAULT 0
);
