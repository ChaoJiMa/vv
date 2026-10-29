// 图片上传相关的纯函数(类型/大小校验、mime→扩展名映射、magic bytes),抽出便于单测。
// 路由 routes/images.js 调用这些函数,真正的 R2 读写在路由里。

// 允许的图片 mime → 文件扩展名。不信任客户端文件名,扩展名一律由 mime 推导。
export const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// 单图大小上限:5MB
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 根据文件头识别图片 MIME；无法识别返回 null */
export function detectImageMime(bytes) {
  if (!bytes || bytes.length < 3) return null
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png'
  // GIF87a / GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) return 'image/gif'
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return null
}

// 校验上传的图片。返回 { ok:true, ext, mime } 或 { ok:false, message }。
// 若提供 bytes，以 magic 为准，不信任客户端 type。
export function validateImage({ type, size, bytes }) {
  // 有正文时以实际字节数为准，不信任客户端声明的 size（防绕过 5MB）
  const buf = bytes == null ? null : (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const actualSize = buf != null ? buf.byteLength : size
  if (typeof actualSize !== 'number' || actualSize <= 0) return { ok: false, message: '图片为空' }
  if (actualSize > MAX_IMAGE_BYTES) return { ok: false, message: '单张图片不能超过 5MB' }

  let mime = type
  if (buf != null) {
    const detected = detectImageMime(buf)
    if (!detected) return { ok: false, message: '仅支持 JPG/PNG/WebP/GIF 图片' }
    mime = detected
  }

  const ext = MIME_EXT[mime]
  if (!ext) return { ok: false, message: '仅支持 JPG/PNG/WebP/GIF 图片' }
  return { ok: true, ext, mime }
}

// 校验读图请求的 key:必须是 <uuid 风格>.<已知扩展名>,防路径穿越 / 读取任意对象。
// genId() 产出十六进制无横杠串,这里宽松匹配字母数字主体 + 已知扩展名即可。
export function isValidKey(key) {
  if (typeof key !== 'string') return false
  return /^[a-zA-Z0-9]+\.(jpg|png|webp|gif)$/.test(key)
}

// 每帖图片数量上限(与前端 MAX_IMAGES 一致)
export const MAX_IMAGES_PER_POST = 6

function positiveInt(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 1 || v > 20000) return null
  return Math.round(v)
}

/**
 * 从图片字节读取宽高（失败返回 null）。
 * 支持 PNG / JPEG / GIF / WebP(VP8/VP8L/VP8X)。
 */
export function readImageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (b.length < 24) return null
  const mime = detectImageMime(b)
  try {
    if (mime === 'image/png') {
      // IHDR: 长宽在偏移 16
      const width = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]
      const height = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (mime === 'image/gif') {
      const width = b[6] | (b[7] << 8)
      const height = b[8] | (b[9] << 8)
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i < b.length - 8) {
        if (b[i] !== 0xff) { i += 1; continue }
        const marker = b[i + 1]
        if (marker === 0xd9 || marker === 0xda) break
        const len = (b[i + 2] << 8) | b[i + 3]
        // SOF0 / SOF2
        if (marker >= 0xc0 && marker <= 0xc3) {
          const height = (b[i + 5] << 8) | b[i + 6]
          const width = (b[i + 7] << 8) | b[i + 8]
          return width > 0 && height > 0 ? { width, height } : null
        }
        i += 2 + len
      }
      return null
    }
    if (mime === 'image/webp' && b.length >= 30) {
      // RIFF....WEBP then chunk
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
      if (chunk === 'VP8X' && b.length >= 30) {
        const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16))
        const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16))
        return { width, height }
      }
      if (chunk === 'VP8 ' && b.length >= 30) {
        const width = b[26] | (b[27] << 8)
        const height = b[28] | (b[29] << 8)
        return { width: width & 0x3fff, height: height & 0x3fff }
      }
      if (chunk === 'VP8L' && b.length >= 25) {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * 清洗发帖 images：元素可为 key 字符串或 { key, width?, height? }。
 * 落库形态统一为 [{ key, width?, height? }, ...]。
 */
export function sanitizeImages(images) {
  if (!Array.isArray(images)) return []
  const seen = new Set()
  const out = []
  for (const item of images) {
    let key
    let width = null
    let height = null
    if (typeof item === 'string') {
      key = item
    } else if (item && typeof item === 'object') {
      key = item.key
      width = positiveInt(item.width)
      height = positiveInt(item.height)
    } else {
      continue
    }
    if (!isValidKey(key) || seen.has(key)) continue
    seen.add(key)
    const row = { key }
    if (width && height) {
      row.width = width
      row.height = height
    }
    out.push(row)
    if (out.length >= MAX_IMAGES_PER_POST) break
  }
  return out
}

/** DB 中 images JSON → [{key,width?,height?}]（兼容旧版纯 key 数组） */
export function parseStoredImages(raw) {
  let arr = raw
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw || '[]') } catch { arr = [] }
  }
  if (!Array.isArray(arr)) return []
  return sanitizeImages(arr.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && item.key) return item
    return null
  }).filter(Boolean))
}

export function imageKeys(storedOrSanitized) {
  const list = Array.isArray(storedOrSanitized) && storedOrSanitized[0] && typeof storedOrSanitized[0] === 'object'
    ? storedOrSanitized
    : parseStoredImages(storedOrSanitized)
  return list.map((i) => i.key).filter(Boolean)
}
