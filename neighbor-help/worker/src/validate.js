// 输入校验:统一约束各字段长度上限,防止超大字符串撑爆 D1 / 滥用。
// 返回 { ok: true, value } 或 { ok: false, message }。

// 各字段长度上限(字符数)
export const LIMITS = {
  title: 100,
  content: 5000,
  comment: 1000,
  nickname: 30,
  building: 30,
  unit: 30,
  username: 30,
  password: 100,
  message: 1000,
  contact: 50,
  location: 50,
  reportReason: 200,
}

// 校验必填字符串:trim 后非空且不超过 max。
export function requireText(value, max, label) {
  if (typeof value !== 'string') return { ok: false, message: `${label}不能为空` }
  const v = value.trim()
  if (!v) return { ok: false, message: `${label}不能为空` }
  if (v.length > max) return { ok: false, message: `${label}不能超过${max}字` }
  return { ok: true, value: v }
}

// 校验可选字符串:允许空;非空时不超过 max。返回 trim 后的值(空则为 '')。
export function optionalText(value, max, label) {
  if (value == null || value === '') return { ok: true, value: '' }
  if (typeof value !== 'string') return { ok: false, message: `${label}格式不正确` }
  const v = value.trim()
  if (v.length > max) return { ok: false, message: `${label}不能超过${max}字` }
  return { ok: true, value: v }
}

// 转义 SQL LIKE 的通配符:把用户输入里的 \ % _ 前面加反斜杠,
// 配合 SQL 的 ESCAPE '\' 子句,使其作为普通字符匹配而非通配,避免搜索行为异常。
// 注意 \ 必须最先处理(否则会重复转义后面替换进来的反斜杠)——正则字符类一次扫描即可保证。
export function escapeLike(keyword) {
  return keyword.replace(/[\\%_]/g, ch => '\\' + ch)
}
