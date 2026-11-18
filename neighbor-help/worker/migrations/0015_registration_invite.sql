-- 可选邀请码只保存注册来源，不建立邀请关系，不授予社区认证或积分奖励。
-- 已有用户保持 NULL；通过 D1 迁移记录确保本文件只应用一次，不重跑历史建库链。
ALTER TABLE users ADD COLUMN registration_invite_code TEXT;
