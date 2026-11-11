import { isValidKey } from './images.js'

// D1 串行处理绑定和删除声明；永久保留声明，防止已通过校验的在途请求重新绑定旧 key。
export const IMAGE_BINDING_ALLOWED = `NOT EXISTS (
  SELECT 1 FROM image_deletions WHERE image_key IN (SELECT value FROM json_each(?))
)`

// 对候选 key 原子声明无帖子/头像引用后再删除 R2 对象，返回本次处理数量。
export async function deleteUnreferencedImages(env, candidates) {
  const keys = [...new Set(candidates.filter(isValidKey))]
  if (!keys.length || !env.IMAGES) return 0
  const encoded = JSON.stringify(keys)
  await env.DB.prepare(`
    INSERT OR IGNORE INTO image_deletions (image_key, claimed_at)
    SELECT candidate.value, ? FROM json_each(?) candidate
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE avatar = candidate.value)
      AND NOT EXISTS (
        SELECT 1 FROM posts p, json_each(COALESCE(NULLIF(p.images, ''), '[]')) image
        WHERE CASE WHEN image.type = 'text' THEN image.value
                   ELSE json_extract(image.value, '$.key') END = candidate.value
      )
  `).bind(Date.now(), encoded).run()
  // 包含历史声明，让上次 R2 删除失败的对象可在下轮重试。
  const { results } = await env.DB.prepare(`
    SELECT image_key FROM image_deletions
    WHERE image_key IN (SELECT value FROM json_each(?))
  `).bind(encoded).all()
  const claimed = results.map(row => row.image_key)
  if (claimed.length) await env.IMAGES.delete(claimed)
  return claimed.length
}

// 内容更新已提交，清理失败仅记录并留给定时任务重试，不回滚业务结果。
export async function cleanupRemovedImages(env, keys) {
  try {
    await deleteUnreferencedImages(env, keys)
  } catch (error) {
    // 读图和新增绑定也检查删除声明，R2 暂时失败不会恢复已声明图片。
    console.error('Image cleanup deferred', error)
  }
}
