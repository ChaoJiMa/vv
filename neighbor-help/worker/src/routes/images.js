// /api 图片路由:上传(需登录) + 读图(公开代理)。
// 设计:图片存 R2,DB 只存 key 数组;读图统一走 GET /api/img/:key 代理,
// 不依赖公开 bucket / 额外域名。key 由 mime 推导扩展名,不信任客户端文件名。
import { Hono } from 'hono'
import { genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { authRequired } from '../middleware.js'
import { rateLimit } from '../ratelimit.js'
import { validateImage, isValidKey, MIME_EXT } from '../images.js'

// 上传限流:同一用户 1 分钟最多 20 张
const UPLOAD_RL_LIMIT = 20
const UPLOAD_RL_WINDOW_MS = 60 * 1000

const images = new Hono()

// POST /api/upload —— 上传单张图片(multipart/form-data,字段名 file)。需登录。
// 返回 { key };前端把 key 收进帖子的 images 数组。
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
  const check = validateImage({ type: file.type, size: file.size })
  if (!check.ok) return fail(CODE.IMAGE_INVALID, check.message)

  const key = `${genId()}.${check.ext}`
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  })
  return success({ key })
})

// GET /api/img/:key —— 公开读图代理。key 唯一且内容不可变,强缓存一年。
images.get('/img/:key', async (c) => {
  const key = c.req.param('key')
  if (!isValidKey(key)) return c.notFound()
  const obj = await c.env.IMAGES.get(key)
  if (!obj) return c.notFound()
  // 优先用存储时记录的 contentType,回退按扩展名推断
  const ext = key.split('.').pop()
  const fallback = Object.keys(MIME_EXT).find(m => MIME_EXT[m] === ext) || 'application/octet-stream'
  const contentType = obj.httpMetadata?.contentType || fallback
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

export default images
