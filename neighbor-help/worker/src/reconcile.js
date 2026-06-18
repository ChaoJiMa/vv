// R2 图片孤儿对账:兜底清理「没有任何帖子引用」的图片对象。
//
// 为什么需要:删帖/编辑帖已在应用层即时清理 R2(见 routes/posts.js),但仍有漏网场景——
// 用户上传了图片却没提交帖子、历史遗留、清理时 R2 异常被吞掉等。这里用定时任务做最终对账。
//
// 安全要点:
// - 宽限期 GRACE_MS:只删「上传时间早于宽限期」的孤儿,避免误删「刚上传、还没提交帖子」的图。
// - 引用集合来自 posts.images(JSON 数组)。逐页扫 posts 汇总所有在用 key。
// - 删除分批进行,避免一次 delete 过多 key。

const GRACE_MS = 24 * 60 * 60 * 1000 // 24 小时:新上传未关联的图在此期限内不清理
const DELETE_BATCH = 100             // 单次 R2 delete 的 key 数上限

// 收集所有被帖子引用的图片 key。逐页读 posts.images 并 JSON.parse 汇总。
async function collectReferencedKeys(env) {
  const referenced = new Set()
  const PAGE = 500
  let offset = 0
  // 按主键分页扫描,避免一次性把全表 images 读进内存
  for (;;) {
    const { results } = await env.DB.prepare(
      'SELECT images FROM posts WHERE images IS NOT NULL AND images != \'\' LIMIT ? OFFSET ?'
    ).bind(PAGE, offset).all()
    const rows = results || []
    for (const r of rows) {
      try {
        const keys = JSON.parse(r.images || '[]')
        if (Array.isArray(keys)) keys.forEach(k => referenced.add(k))
      } catch { /* 单行损坏忽略,不影响整体对账 */ }
    }
    if (rows.length < PAGE) break
    offset += PAGE
  }
  return referenced
}

// 执行一次对账。返回 { scanned, deleted } 便于日志。
export async function reconcileImages(env) {
  if (!env.IMAGES) return { scanned: 0, deleted: 0 }
  const referenced = await collectReferencedKeys(env)
  const cutoff = Date.now() - GRACE_MS

  let scanned = 0
  let deleted = 0
  let pending = []
  let cursor

  // 遍历 R2 全部对象,挑出「无引用且早于宽限期」的孤儿,分批删除
  for (;;) {
    const listing = await env.IMAGES.list({ cursor, limit: 1000 })
    for (const obj of listing.objects) {
      scanned++
      const uploadedMs = obj.uploaded instanceof Date ? obj.uploaded.getTime() : new Date(obj.uploaded).getTime()
      if (!referenced.has(obj.key) && uploadedMs < cutoff) {
        pending.push(obj.key)
        if (pending.length >= DELETE_BATCH) {
          await env.IMAGES.delete(pending)
          deleted += pending.length
          pending = []
        }
      }
    }
    if (!listing.truncated) break
    cursor = listing.cursor
  }
  if (pending.length) {
    await env.IMAGES.delete(pending)
    deleted += pending.length
  }
  return { scanned, deleted }
}
