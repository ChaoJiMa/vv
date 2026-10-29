// 图片相关前端工具:上传前降采样 + 安全解析 images JSON。

/** 把 posts.images(JSON 字符串 / 数组)解析为原始数组。非法/空一律 []。 */
export function safeParse(jsonStr) {
  if (Array.isArray(jsonStr)) return jsonStr
  if (!jsonStr) return []
  try {
    const v = JSON.parse(jsonStr)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * 统一为 [{ key, width?, height? }, ...]
 * 兼容：纯 key 字符串数组、DTO 的 string[] + cover、落库对象数组。
 */
export function normalizeImages(raw, cover) {
  const arr = safeParse(raw)
  const out = []
  const seen = new Set()
  for (const item of arr) {
    let key
    let width
    let height
    if (typeof item === 'string') {
      key = item
    } else if (item && typeof item === 'object' && item.key) {
      key = item.key
      width = item.width
      height = item.height
    } else {
      continue
    }
    if (!key || seen.has(key)) continue
    seen.add(key)
    const row = { key }
    if (width > 0 && height > 0) {
      row.width = Number(width)
      row.height = Number(height)
    }
    out.push(row)
  }
  // DTO 可能只在 cover 上带首图尺寸
  if (cover?.key && cover.width > 0 && cover.height > 0) {
    const hit = out.find((i) => i.key === cover.key)
    if (hit && !hit.width) {
      hit.width = Number(cover.width)
      hit.height = Number(cover.height)
    }
  }
  return out
}

export function imageKeys(raw, cover) {
  return normalizeImages(raw, cover).map((i) => i.key)
}

/** 首图 key（兼容 cover） */
export function coverKey(post) {
  if (post?.cover?.key) return post.cover.key
  return normalizeImages(post?.images, post?.cover)[0]?.key || null
}

/** 有已知宽高时返回 h/w，否则 null（交给预加载） */
export function coverAspectRatio(post) {
  const cover = post?.cover
  if (cover?.width > 0 && cover?.height > 0) {
    return cover.height / cover.width
  }
  const first = normalizeImages(post?.images, post?.cover)[0]
  if (first?.width > 0 && first?.height > 0) {
    return first.height / first.width
  }
  return null
}

// 上传前降采样:长边超过 maxEdge 才缩放,导出为 JPEG/WebP 控制体积。
export async function downscaleImage(file, maxEdge = 1600, quality = 0.82) {
  if (!file || !file.type?.startsWith('image/') || file.type === 'image/gif') {
    return { file, width: null, height: null }
  }
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    if (scale === 1) {
      bitmap.close?.()
      return { file, width, height }
    }

    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const outType = file.type === 'image/png' ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, quality))
    if (!blob) return { file, width, height }
    const ext = outType === 'image/webp' ? 'webp' : 'jpg'
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.' + ext
    return { file: new File([blob], name, { type: outType }), width: w, height: h }
  } catch {
    return { file, width: null, height: null }
  }
}
