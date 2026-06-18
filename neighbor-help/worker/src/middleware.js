// Hono 中间件:鉴权 + 请求日志。把原来每个 handler 里重复的
// verifyAuth/unauth 与入口处的日志逻辑收敛到这里。
import { verifyAuth } from './auth.js'
import { fail, CODE } from './response.js'
import { describeRoute, readBodyForLog, genRequestId, logRequest, peekUserId } from './logger.js'

// 鉴权中间件:验签失败直接 401;成功则把 userId 注入 context 供 handler 取用。
export async function authRequired(c, next) {
  const payload = await verifyAuth(c.req.raw, c.env)
  if (!payload) return fail(CODE.UNAUTHORIZED, '未登录')
  c.set('userId', payload.userId)
  await next()
}

// 日志中间件:记录接口描述、入参、出参 code/message、耗时、报错。
// 包裹整个请求;错误由 app.onError 统一兜底,这里只负责读取结果落日志。
export async function logging(c, next) {
  const reqId = genRequestId()
  const start = Date.now()
  const method = c.req.method
  const pathname = c.req.path
  const desc = describeRoute(method, pathname)
  const query = Object.fromEntries(new URL(c.req.url).searchParams)
  const userId = peekUserId(c.req.raw) // 仅日志标注,不代表已验签
  const body = await readBodyForLog(c.req.raw) // 克隆读取,不影响 handler

  let caught
  try {
    await next()
  } catch (e) {
    caught = e
    throw e // 交给 app.onError 统一返回 500
  } finally {
    // 读取响应 code/message(克隆,避免消费原始响应体)
    let resCode, resMessage
    try {
      const peek = await c.res.clone().json()
      resCode = peek.code
      resMessage = peek.message
    } catch {
      // 非 JSON 响应忽略
    }
    logRequest({
      reqId,
      userId,
      desc,
      method,
      pathname,
      query,
      body,
      code: resCode,
      message: resMessage,
      status: c.res?.status,
      durationMs: Date.now() - start,
      error: caught,
    })
  }
}
