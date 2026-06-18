// 敏感词过滤:发帖/评论/私信内容做基础合规拦截。
//
// 这是「基础防线」而非完备方案 —— 词表精简、只做包含匹配,目的是挡住最明显的
// 辱骂/赌博/色情/诈骗引流类内容。真正的内容治理还需配合「举报 + 人工复核」
// (见 routes/reports.js)。词表后续可按社区实际情况增补。
//
// 设计取舍:
// - 归一化后匹配:转小写 + 去掉空白与常见分隔符,挡住"赌 博""d博"这类拆字规避。
//   注意只去分隔符,不做同音/形近字还原(代价高、误伤大),那属于更重的方案。
// - 返回命中的第一个词即可,用于给用户明确提示,不必列全部。

// 分隔符:空白 + 常见用于拆字规避的标点。归一化时一并剔除。
const SEPARATORS = /[\s.·•、,，。!！?？*~\-_/\\|]+/g

// 词表:按类别组织,仅供示意与基础拦截,生产可持续增补或改为远端配置。
const WORDS = [
  // 赌博 / 资金盘引流
  '赌博', '博彩', '澳门赌场', '六合彩', '时时彩', '私彩', '菠菜平台',
  // 色情
  '色情', '裸聊', '约炮', '一夜情', '黄片', '成人影片',
  // 诈骗 / 违规交易引流
  '刷单返利', '兼职刷单', '高额返利', '微信加我转账', '代开发票', '办理证件',
  '出售个人信息', '银行卡套现', '贷款无抵押秒下',
  // 违禁品
  '枪支弹药', '管制刀具', '迷药', '催情',
  // 辱骂(轻量,避免误伤,仅列最常见)
  '傻逼', '操你妈', '草泥马', '狗东西',
]

// 预归一化词表,匹配时与归一化后的输入做包含判断
const NORMALIZED = WORDS.map(w => ({ raw: w, norm: normalize(w) }))

// 归一化:转小写 + 去分隔符
function normalize(text) {
  return String(text).toLowerCase().replace(SEPARATORS, '')
}

// 返回命中的第一个敏感词(原词),未命中返回 null。
export function findSensitive(text) {
  if (!text) return null
  const norm = normalize(text)
  if (!norm) return null
  for (const w of NORMALIZED) {
    if (w.norm && norm.includes(w.norm)) return w.raw
  }
  return null
}
