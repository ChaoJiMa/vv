// 统一响应封装 + 分段业务码
//
// 所有接口返回统一结构:{ code, message, data }
//   code === 200      表示成功
//   code !== 200      表示失败,前端据此 toast message
//
// 业务码分段:
//   10xx 认证 / 用户
//   20xx 帖子 / 评论
//   4xx / 5xx 通用错误(沿用 HTTP 语义,便于前端按 HTTP 状态做 401 拦截等)
export const CODE = {
  OK: 200,

  // 通用
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,      // 限流:请求过于频繁
  SERVER_ERROR: 500,

  // 认证 / 用户 10xx
  USERNAME_TAKEN: 1001,        // 用户名已被注册
  INVALID_CREDENTIALS: 1002,   // 用户名或密码错误
  INVALID_INPUT: 1003,         // 注册/登录参数不合法
  WECHAT_FAILED: 1004,         // 微信授权失败
  WRONG_OLD_PASSWORD: 1005,    // 修改密码时旧密码错误
  NO_PASSWORD_SET: 1006,       // 账号未设置密码(如微信用户)无法用旧密码校验

  // 帖子 / 评论 20xx
  POST_NOT_FOUND: 2001,        // 帖子不存在
  POST_MISSING_FIELD: 2002,    // 发帖缺少必要字段
  COMMENT_EMPTY: 2003,         // 评论内容为空
  COMMENT_NOT_FOUND: 2004,     // 评论不存在或无权操作
  CONTENT_BLOCKED: 2005,       // 内容含敏感词,被拦截
  IMAGE_INVALID: 2006,         // 图片类型/大小不合法

  // 私信 / 通知 30xx
  MESSAGE_EMPTY: 3001,         // 私信内容为空
  MESSAGE_BAD_TARGET: 3002,    // 私信对象不存在或为自己

  // 举报 40xx(注意与通用 4xx HTTP 码区分:这里是四位业务码)
  REPORT_BAD_TARGET: 4001,     // 举报对象无效
  REPORT_DUPLICATE: 4002,      // 已举报过,请勿重复
}

// 每个业务码对应的 HTTP 状态码(默认按分段推断)
const HTTP_STATUS = {
  [CODE.OK]: 200,
  [CODE.BAD_REQUEST]: 400,
  [CODE.UNAUTHORIZED]: 401,
  [CODE.NOT_FOUND]: 404,
  [CODE.TOO_MANY_REQUESTS]: 429,
  [CODE.SERVER_ERROR]: 500,
  [CODE.USERNAME_TAKEN]: 409,
  [CODE.INVALID_CREDENTIALS]: 401,
  [CODE.INVALID_INPUT]: 400,
  [CODE.WECHAT_FAILED]: 401,
  [CODE.WRONG_OLD_PASSWORD]: 401,
  [CODE.NO_PASSWORD_SET]: 400,
  [CODE.POST_NOT_FOUND]: 404,
  [CODE.POST_MISSING_FIELD]: 400,
  [CODE.COMMENT_EMPTY]: 400,
  [CODE.COMMENT_NOT_FOUND]: 404,
  [CODE.CONTENT_BLOCKED]: 400,
  [CODE.IMAGE_INVALID]: 400,
  [CODE.MESSAGE_EMPTY]: 400,
  [CODE.MESSAGE_BAD_TARGET]: 404,
  [CODE.REPORT_BAD_TARGET]: 404,
  [CODE.REPORT_DUPLICATE]: 409,
}

// headers 可选:Hono 下由 cors 中间件统一补 CORS 头,这里只需保证 Content-Type。
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function success(data = null, headers = JSON_HEADERS, message = 'ok') {
  return new Response(
    JSON.stringify({ code: CODE.OK, message, data }),
    { status: 200, headers }
  )
}

export function fail(code, message, headers = JSON_HEADERS) {
  const status = HTTP_STATUS[code] || 400
  return new Response(
    JSON.stringify({ code, message, data: null }),
    { status, headers }
  )
}
