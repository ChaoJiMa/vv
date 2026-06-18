// 应用配置读取:小区结构等运营配置存于 D1 的 app_config 表(value 为 JSON 字符串),
// 运营可直接 UPDATE 调整,无需改代码部署。带 60s 内存缓存,避免高频接口每次打 D1。
// 敏感词配置另见 sensitive.js(同样的 app_config 表,独立缓存)。

const TTL_MS = 60 * 1000
const cache = new Map() // key -> { value, at }

// 读取单个配置项并 JSON.parse。失败(缺失/损坏)时返回 fallback,不抛错。
async function loadConfig(env, key, fallback) {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.value
  let value = fallback
  try {
    const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first()
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      if (parsed && typeof parsed === 'object') value = parsed
    }
  } catch { /* 配置缺失/损坏:用 fallback */ }
  cache.set(key, { value, at: now })
  return value
}

// 小区结构(期数 -> 楼栋 -> 单元)。配置缺失时返回空对象(前端表现为无可选项)。
export function getCommunity(env) {
  return loadConfig(env, 'community', {})
}

// 首页公告与安全提示。配置缺失时返回内置兜底(避免首页空白)。
// 形如 { notices: string[], safetyTips: [{ icon, text }] }。
const ANNOUNCEMENTS_FALLBACK = {
  notices: [
    '欢迎来到邻里里,远亲不如近邻 🏠',
    '文明互助,共建友善社区 🌱',
    '交易注意安全,谨防诈骗 ⚠️',
  ],
  safetyTips: [
    { icon: '🔒', text: '见面交易选在小区公共区域,结伴更安心' },
    { icon: '💰', text: '大额交易当面验货,警惕预付定金类骗局' },
    { icon: '📵', text: '不向陌生人透露验证码、银行卡等敏感信息' },
    { icon: '🤝', text: '文明互助、理性沟通,共建友善邻里关系' },
  ],
}

export function getAnnouncements(env) {
  return loadConfig(env, 'announcements', ANNOUNCEMENTS_FALLBACK)
}

// 测试用:清空缓存。
export function _clearConfigCache() {
  cache.clear()
}
