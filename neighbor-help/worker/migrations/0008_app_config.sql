-- 0008_app_config.sql —— 应用配置表:把原先写死在代码里的「小区结构」与「敏感词表」移入 D1。
-- 运营改这两类配置时只需 UPDATE 本表,无需改代码重新部署。
-- value 统一存 JSON 字符串(小区为对象、敏感词为数组),由应用层 JSON.parse 读取。
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,          -- 配置项:'community' / 'sensitive_words'
  value TEXT                     -- JSON 字符串
);

-- 种子:小区结构(期数 -> 楼栋 -> 单元),与原 routes/posts.js 的 COMMUNITY 常量一致。
INSERT INTO app_config (key, value) VALUES (
  'community',
  '{"一期":{"1号楼":["1单元","2单元","3单元"],"2号楼":["1单元","2单元"],"3号楼":["1单元","2单元","3单元","4单元"]},"二期":{"4号楼":["1单元","2单元"],"5号楼":["1单元","2单元","3单元"],"6号楼":["1单元"]},"三期":{"7号楼":["1单元","2单元"],"8号楼":["1单元","2单元","3单元"]}}'
) ON CONFLICT(key) DO NOTHING;

-- 种子:敏感词表,与原 src/sensitive.js 的 WORDS 数组一致。
INSERT INTO app_config (key, value) VALUES (
  'sensitive_words',
  '["赌博","博彩","澳门赌场","六合彩","时时彩","私彩","菠菜平台","色情","裸聊","约炮","一夜情","黄片","成人影片","刷单返利","兼职刷单","高额返利","微信加我转账","代开发票","办理证件","出售个人信息","银行卡套现","贷款无抵押秒下","枪支弹药","管制刀具","迷药","催情","傻逼","操你妈","草泥马","狗东西"]'
) ON CONFLICT(key) DO NOTHING;
