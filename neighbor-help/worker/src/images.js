// 图片上传相关的纯函数(类型/大小校验、mime→扩展名映射),抽出便于单测。
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

// 校验上传的图片。返回 { ok:true, ext } 或 { ok:false, message }。
export function validateImage({ type, size }) {
  const ext = MIME_EXT[type]
  if (!ext) return { ok: false, message: '仅支持 JPG/PNG/WebP/GIF 图片' }
  if (typeof size !== 'number' || size <= 0) return { ok: false, message: '图片为空' }
  if (size > MAX_IMAGE_BYTES) return { ok: false, message: '单张图片不能超过 5MB' }
  return { ok: true, ext }
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
