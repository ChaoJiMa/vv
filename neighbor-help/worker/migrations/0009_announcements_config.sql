-- 0009_announcements_config.sql —— 首页公告与安全提示移入 app_config。
-- 与原 frontend Home.jsx 的 NOTICES / SAFETY_TIPS 一致,运营可直接 UPDATE 调整。
-- value 为 JSON 对象:{ notices: string[], safetyTips: [{ icon, text }] }。
INSERT INTO app_config (key, value) VALUES (
  'announcements',
  '{"notices":["欢迎来到邻里里,远亲不如近邻 🏠","文明互助,共建友善社区 🌱","交易注意安全,谨防诈骗 ⚠️"],"safetyTips":[{"icon":"🔒","text":"见面交易选在小区公共区域,结伴更安心"},{"icon":"💰","text":"大额交易当面验货,警惕预付定金类骗局"},{"icon":"📵","text":"不向陌生人透露验证码、银行卡等敏感信息"},{"icon":"🤝","text":"文明互助、理性沟通,共建友善邻里关系"}]}'
) ON CONFLICT(key) DO NOTHING;
