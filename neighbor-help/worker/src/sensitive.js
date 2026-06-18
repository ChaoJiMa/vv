// 敏感词过滤:发帖/评论/私信内容做基础合规拦截。
//
// 这是「基础防线」而非完备方案 —— 词表精简、只做包含匹配,目的是挡住最明显的
// 辱骂/赌博/色情/诈骗引流类内容。真正的内容治理还需配合「举报 + 人工复核」
// (见 routes/reports.js)。
//
// 词表存于 D1 的 app_config 表(key='sensitive_words',value 为 JSON 数组),
// 运营可直接 UPDATE 调整,无需改代码部署。本模块带 60s 内存缓存,避免每次发帖打 D1。
//
// 设计取舍:
// - 归一化后匹配:转小写 + 去掉空白与常见分隔符,挡住"赌 博""d博"这类拆字规避。
//   注意只去分隔符,不做同音/形近字还原(代价高、误伤大),那属于更重的方案。
// - 返回命中的第一个词即可,用于给用户明确提示,不必列全部。

// 分隔符:空白 + 常见用于拆字规避的标点。归一化时一并剔除。
const SEPARATORS = /[\s.·•、,，。!！?？*~\-_/\\|]+/g

// 归一化:转小写 + 去分隔符
function normalize(text) {
  return String(text).toLowerCase().replace(SEPARATORS, '')
}

// 纯函数:给定词表与待检文本,返回命中的第一个敏感词(原词),未命中返回 null。
// 抽成纯函数便于单测,不依赖 env/DB。
export function matchSensitive(words, text) {
  if (!text || !Array.isArray(words)) return null
  const norm = normalize(text)
  if (!norm) return null
  for (const w of words) {
    const wn = normalize(w)
    if (wn && norm.includes(wn)) return w
  }
  return null
}

// ===== 词表加载(D1 + 60s TTL 内存缓存) =====
let cache = { words: null, at: 0 }
const TTL_MS = 60 * 1000

// 从 app_config 读敏感词数组,带缓存。读取/解析失败时回退空数组(不拦截),
// 避免配置异常时阻断所有发帖。
async function loadWords(env) {
  const now = Date.now()
  if (cache.words && now - cache.at < TTL_MS) return cache.words
  let words = []
  try {
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'sensitive_words'").first()
    const parsed = row?.value ? JSON.parse(row.value) : []
    if (Array.isArray(parsed)) words = parsed
  } catch { /* 配置缺失/损坏:回退空表,不拦截 */ }
  cache = { words, at: now }
  return words
}

// 异步:从 D1(带缓存)加载词表后做匹配。返回命中的第一个敏感词或 null。
export async function findSensitive(env, text) {
  const words = await loadWords(env)
  return matchSensitive(words, text)
}

// 测试用:清空缓存,确保用例间不互相影响。
export function _clearSensitiveCache() {
  cache = { words: null, at: 0 }
}
