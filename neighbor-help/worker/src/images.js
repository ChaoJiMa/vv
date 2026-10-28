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

// 清洗发帖/编辑传入的 images:后端是信任边界,不能直接存客户端数据。
// 只保留合法 key、去重、截断到上限;非数组一律视为空。始终返回数组。
export function sanitizeImages(images) {
  if (!Array.isArray(images)) return []
  const seen = new Set()
  const out = []
  for (const k of images) {
    if (isValidKey(k) && !seen.has(k)) {
      seen.add(k)
      out.push(k)
      if (out.length >= MAX_IMAGES_PER_POST) break
    }
  }
  return out
}
