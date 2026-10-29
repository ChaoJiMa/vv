/** 双方 id 字典序，保证 UNIQUE(user_a,user_b,post_id) 稳定 */
export function pairUsers(a, b) {
  return a < b ? [a, b] : [b, a]
}

/** 列表/顶栏展示用帖标题；帖已删或无标题时统一文案 */
export function displayPostTitle(title, postDeleted) {
  if (postDeleted) return '原帖已删除'
  return (title && String(title).trim()) || '原帖已删除'
}

/**
 * 按帖私信：当前用户与对方中必须有一方是帖主
 * （访客→帖主，或帖主→某邻居；禁止两人就无关第三方的帖开会话）
 */
export function canOpenPostDm(postAuthorId, me, peer) {
  if (!postAuthorId || !me || !peer || me === peer) return false
  return postAuthorId === me || postAuthorId === peer
}

/** 空会话保留时长（仅 ensure、未发过消息）；超时可清 */
export const EMPTY_CONV_TTL_MS = 24 * 60 * 60 * 1000
