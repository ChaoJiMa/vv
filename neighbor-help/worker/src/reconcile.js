import { isValidKey } from './images.js'
import { IMAGE_GRACE_MS } from './imageAccess.js'
import { deleteUnreferencedImages } from './imageCleanup.js'

const PAGE_SIZE = 500
const DELETE_BATCH = 100

// 帖子与头像共用 R2；引用损坏时中止清理，避免把未知引用当作孤儿。
async function collectReferencedKeys(env) {
  const referenced = new Set()
  let after = ''
  for (;;) {
    const { results: rows } = await env.DB.prepare(
      "SELECT id, images FROM posts WHERE id > ? AND images IS NOT NULL AND images != '' ORDER BY id LIMIT ?"
    ).bind(after, PAGE_SIZE).all()
    for (const row of rows) {
      const images = JSON.parse(row.images)
      if (!Array.isArray(images)) throw new Error('Invalid stored image references')
      for (const image of images) {
        const key = typeof image === 'string' ? image : image?.key
        if (!isValidKey(key)) throw new Error('Invalid stored image reference')
        referenced.add(key)
      }
    }
    if (rows.length < PAGE_SIZE) break
    after = rows[rows.length - 1].id
  }
  after = ''
  for (;;) {
    const { results: rows } = await env.DB.prepare(
      "SELECT id, avatar FROM users WHERE id > ? AND avatar IS NOT NULL AND avatar != '' ORDER BY id LIMIT ?"
    ).bind(after, PAGE_SIZE).all()
    for (const row of rows) {
      if (isValidKey(row.avatar)) referenced.add(row.avatar)
    }
    if (rows.length < PAGE_SIZE) break
    after = rows[rows.length - 1].id
  }
  return referenced
}

export async function reconcileImages(env) {
  if (!env.IMAGES) return { scanned: 0, deleted: 0 }
  const referenced = await collectReferencedKeys(env)
  const cutoff = Date.now() - IMAGE_GRACE_MS

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
          deleted += await deleteUnreferencedImages(env, pending)
          pending = []
        }
      }
    }
    if (!listing.truncated) break
    cursor = listing.cursor
  }
  if (pending.length) {
    deleted += await deleteUnreferencedImages(env, pending)
  }
  return { scanned, deleted }
}
