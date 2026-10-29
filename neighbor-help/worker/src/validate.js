// 输入校验:统一约束各字段长度上限,防止超大字符串撑爆 D1 / 滥用。
// 返回 { ok: true, value } 或 { ok: false, message }。

import { isValidKey } from './images.js'

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
  announcement: 200,
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

/** 可选纯数字字段（楼栋 / 房号）；空放行，非空须全为数字且不超过 max */
export function optionalDigits(value, max, label) {
  if (value == null || value === '') return { ok: true, value: '' }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { ok: false, message: `${label}格式不正确` }
  }
  const v = String(value).trim()
  if (!v) return { ok: true, value: '' }
  if (!/^\d+$/.test(v)) return { ok: false, message: `${label}只能填写数字` }
  if (v.length > max) return { ok: false, message: `${label}不能超过${max}位` }
  return { ok: true, value: v }
}

/**
 * 解析 /me/update 的 avatar 字段。
 * - undefined：不改
 * - null / ''：清空
 * - 合法 R2 key：更新
 * 不接受外链 URL（上传须走 /api/upload）。
 */
export function parseAvatarUpdate(avatar) {
  if (avatar === undefined) return { ok: true, change: false }
  if (avatar === null || avatar === '') return { ok: true, change: true, value: null }
  if (typeof avatar !== 'string' || !isValidKey(avatar)) {
    return { ok: false, message: '头像无效' }
  }
  return { ok: true, change: true, value: avatar }
}

/**
 * 头像更新后需要从 R2 删除的旧 key。
 * 仅当旧值是合法 R2 key 且与新值不同时返回旧 key；外链/空/未变返回 null。
 */
export function staleAvatarKey(prev, next) {
  if (typeof prev !== 'string' || !isValidKey(prev)) return null
  if (prev === next) return null
  return prev
}

// 转义 SQL LIKE 的通配符:把用户输入里的 \ % _ 前面加反斜杠,
// 配合 SQL 的 ESCAPE '\' 子句,使其作为普通字符匹配而非通配,避免搜索行为异常。
// 注意 \ 必须最先处理(否则会重复转义后面替换进来的反斜杠)——正则字符类一次扫描即可保证。
export function escapeLike(keyword) {
  return keyword.replace(/[\\%_]/g, ch => '\\' + ch)
}
