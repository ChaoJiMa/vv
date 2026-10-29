import { api } from '../api'

/**
 * 把头像字段解析为可给 <img src> 的 URL。
 * - 空 → null（调用方用字母占位）
 * - http(s) 外链（如微信）→ 原样
 * - 否则视为 R2 key → /api/img/:key
 */
export function resolveAvatarUrl(avatar) {
  if (avatar == null) return null
  const s = String(avatar).trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  return api.imgUrl(s)
}
