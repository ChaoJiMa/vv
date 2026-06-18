// 图片相关前端工具:上传前降采样 + 安全解析 images JSON。

// 把 posts.images(JSON 字符串)安全解析为数组。非法/空一律返回 []。
export function safeParse(jsonStr) {
  if (Array.isArray(jsonStr)) return jsonStr // 已是数组直接用
  if (!jsonStr) return []
  try {
    const v = JSON.parse(jsonStr)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// 上传前降采样:长边超过 maxEdge 才缩放,导出为 JPEG/WebP 控制体积。
// 手机原图常 >5MB,不压会被后端 5MB 限制频繁挡住。
// - gif 跳过(动图压了会丢帧/变静图)
// - 非图片或处理失败时,原样返回 file(交给后端校验兜底)
export async function downscaleImage(file, maxEdge = 1600, quality = 0.82) {
  if (!file || !file.type?.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    // 已经够小:不重新编码,直接用原文件(避免无谓的二次压缩劣化)
    if (scale === 1) { bitmap.close?.(); return file }

    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    // PNG(可能含透明)导出为 webp 保真;其余统一 jpeg
    const outType = file.type === 'image/png' ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, quality))
    if (!blob) return file
    const ext = outType === 'image/webp' ? 'webp' : 'jpg'
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.' + ext
    return new File([blob], name, { type: outType })
  } catch {
    return file
  }
}
