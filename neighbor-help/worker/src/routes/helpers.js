// 帖子相关的纯逻辑(不依赖 env/DB),抽出便于单测与复用。

// 关帖采纳:从用户提交的 helpers 里筛出「有效采纳者」。
// 规则(与 posts/close 一致):
//   - 必须在 allow 集合内(本帖响应者 ∪ 评论者,已在 SQL 里排除帖主)
//   - 排除帖主自己(ownerId)
//   - 同一人只取一次(去重,保留首次出现)
//   - thanked 归一化为 1(采纳并感谢)/ 0(仅采纳)
// 入参 picked 为客户端数据(不可信),allow 为 Set<helperId>。返回 [{ helperId, thanked }]。
export function pickValidHelpers(picked, allow, ownerId) {
  if (!Array.isArray(picked) || !picked.length) return []
  const allowSet = allow instanceof Set ? allow : new Set(allow || [])
  const seen = new Set()
  const out = []
  for (const h of picked) {
    const hid = h?.helperId
    if (hid && hid !== ownerId && allowSet.has(hid) && !seen.has(hid)) {
      seen.add(hid)
      out.push({ helperId: hid, thanked: h.thanked ? 1 : 0 })
    }
  }
  return out
}
