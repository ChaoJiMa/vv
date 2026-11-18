// /api 图片路由:上传(需登录) + 读图(公开代理)。
// 设计:图片存 R2,DB 只存 key 数组;读图统一走 GET /api/img/:key 代理,
// 不依赖公开 bucket / 额外域名。key 由 mime 推导扩展名,不信任客户端文件名。
import { Hono } from 'hono'
import { genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { authRequired } from '../middleware.js'
import { rateLimit } from '../ratelimit.js'
import { validateImage, isValidKey, MIME_EXT, readImageSize } from '../images.js'

// 上传限流:同一用户 1 分钟最多 20 张
const UPLOAD_RL_LIMIT = 20
const UPLOAD_RL_WINDOW_MS = 60 * 1000

const images = new Hono()

// POST /api/upload —— 上传单张图片(multipart/form-data,字段名 file)。需登录。
// 返回 { key, width?, height? };前端把对象收进帖子的 images 数组。
images.post('/upload', authRequired, async (c) => {
  const userId = c.get('userId')
  const rl = await rateLimit(c.env, `upload:${userId}`, UPLOAD_RL_LIMIT, UPLOAD_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `上传过于频繁,请${rl.retryAfter}秒后再试`)

  let body
  try {
    body = await c.req.parseBody()
  } catch {
    return fail(CODE.IMAGE_INVALID, '上传内容解析失败')
  }
  const file = body?.file
  // parseBody 对文件返回 File 对象;非文件(字符串)视为无效
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return fail(CODE.IMAGE_INVALID, '未找到上传文件')
  }
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const check = validateImage({ type: file.type, size: bytes.byteLength, bytes })
  if (!check.ok) return fail(CODE.IMAGE_INVALID, check.message)

  // 优先服务端解析尺寸;表单 width/height 仅作兜底(须为正整数)
  const parsed = readImageSize(bytes)
  const formW = Number(body?.width)
  const formH = Number(body?.height)
  const width = parsed?.width || (Number.isFinite(formW) && formW > 0 ? Math.round(formW) : null)
  const height = parsed?.height || (Number.isFinite(formH) && formH > 0 ? Math.round(formH) : null)

  const key = `${genId()}.${check.ext}`
  await c.env.IMAGES.put(key, buf, {
    httpMetadata: { contentType: check.mime },
    customMetadata: {
      ownerId: userId,
      ...(width && height ? { width: String(width), height: String(height) } : {}),
    },
  })
  return success({
    key,
    ...(width && height ? { width, height } : {}),
  })
})

// GET /api/img/:key —— 每次重验证，删除声明提交后即停止提供对象。
images.get('/img/:key', async (c) => {
  const key = c.req.param('key')
  if (!isValidKey(key)) return c.notFound()
  const deleted = await c.env.DB.prepare('SELECT 1 FROM image_deletions WHERE image_key=?').bind(key).first()
  if (deleted) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  // 只转发 If-None-Match；由 R2 处理弱 ETag、列表与通配符，命中时不读取正文。
  const ifNoneMatch = c.req.header('If-None-Match')
  const obj = await c.env.IMAGES.get(key, ifNoneMatch
    ? { onlyIf: new Headers({ 'If-None-Match': ifNoneMatch }) }
    : undefined)
  if (!obj) return c.notFound()
  // 优先用存储时记录的 contentType,回退按扩展名推断
  const ext = key.split('.').pop()
  const fallback = Object.keys(MIME_EXT).find(m => MIME_EXT[m] === ext) || 'application/octet-stream'
  const contentType = obj.httpMetadata?.contentType || fallback
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'public, no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...(obj.httpEtag ? { ETag: obj.httpEtag } : {}),
  }
  if (!('body' in obj)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(obj.body, {
    headers,
  })
})

export default images
