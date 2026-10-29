/** 对外展示名：只用水名昵称，不回落用户名 */
export function displayName(person) {
  const n = person?.nickname
  if (typeof n === 'string' && n.trim()) return n.trim()
  return '邻居'
}

/** 头像占位字：取昵称首字 */
export function displayInitial(person, fallback = '邻') {
  const n = displayName(person)
  if (n === '邻居') return fallback
  return n[0] || fallback
}
