// 请求日志:在统一入口记录每个请求的接口描述、入参、出参、报错原因、耗时。
// 日志输出到 console,生产环境用 `npx wrangler tail` 查看。

// 路由 -> 中文接口描述。全部接口统一 POST,按精确路径匹配。
const ROUTES = [
  { method: 'POST', re: /^\/auth\/register$/,        desc: '用户注册' },
  { method: 'POST', re: /^\/auth\/login$/,           desc: '用户登录' },
  { method: 'POST', re: /^\/auth\/wechat$/,          desc: '微信授权登录' },
  { method: 'POST', re: /^\/api\/menus\/list$/,      desc: '获取服务类型菜单' },
  { method: 'POST', re: /^\/api\/me\/get$/,          desc: '获取当前用户信息' },
  { method: 'POST', re: /^\/api\/me\/update$/,       desc: '更新个人资料' },
  { method: 'POST', re: /^\/api\/me\/password$/,     desc: '修改密码' },
  { method: 'POST', re: /^\/api\/me\/logout$/,       desc: '退出登录' },
  { method: 'POST', re: /^\/api\/me\/posts$/,        desc: '我发布的帖子' },
  { method: 'POST', re: /^\/api\/me\/stats$/,        desc: '个人数据统计' },
  { method: 'POST', re: /^\/api\/posts\/list$/,      desc: '获取帖子列表' },
  { method: 'POST', re: /^\/api\/posts\/detail$/,    desc: '获取帖子详情' },
  { method: 'POST', re: /^\/api\/posts\/comments$/,  desc: '获取评论列表' },
  { method: 'POST', re: /^\/api\/posts\/create$/,    desc: '发布帖子' },
  { method: 'POST', re: /^\/api\/posts\/update$/,    desc: '编辑帖子' },
  { method: 'POST', re: /^\/api\/posts\/comment$/,   desc: '发表评论' },
  { method: 'POST', re: /^\/api\/posts\/comment\/delete$/, desc: '删除评论' },
  { method: 'POST', re: /^\/api\/posts\/helpers\/candidates$/, desc: '采纳候选人' },
  { method: 'POST', re: /^\/api\/posts\/respond$/,   desc: '响应帖子' },
  { method: 'POST', re: /^\/api\/posts\/unrespond$/, desc: '取消响应' },
  { method: 'POST', re: /^\/api\/posts\/close$/,     desc: '标记帖子完成' },
  { method: 'POST', re: /^\/api\/posts\/delete$/,    desc: '删除帖子' },
  { method: 'POST', re: /^\/api\/messages\/send$/,          desc: '发送私信' },
  { method: 'POST', re: /^\/api\/messages\/thread$/,        desc: '聊天记录' },
  { method: 'POST', re: /^\/api\/messages\/conversations$/, desc: '会话列表' },
  { method: 'POST', re: /^\/api\/messages\/unread$/,        desc: '未读总数' },
  { method: 'POST', re: /^\/api\/notifications\/list$/,     desc: '通知列表' },
  { method: 'POST', re: /^\/api\/notifications\/read$/,     desc: '标记通知已读' },
  { method: 'POST', re: /^\/api\/reports\/create$/,         desc: '举报帖子或评论' },
  { method: 'POST', re: /^\/api\/community\/structure$/,    desc: '小区结构' },
  { method: 'POST', re: /^\/api\/upload$/,                  desc: '上传图片' },
  { method: 'GET',  re: /^\/api\/img\/.+$/,                 desc: '读取图片' },
]

export function describeRoute(method, pathname) {
  const hit = ROUTES.find(r => r.method === method && r.re.test(pathname))
  return hit ? hit.desc : '未知接口'
}

// 敏感字段脱敏:绝不记录明文密码 / token
const SENSITIVE_KEYS = ['password', 'oldPassword', 'newPassword', 'token', 'access_token']

export function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(k)) {
      out[k] = '***'
    } else if (v && typeof v === 'object') {
      out[k] = redact(v)
    } else {
      out[k] = v
    }
  }
  return out
}

// 安全读取请求体(克隆,不消费原始 request),用于日志。失败返回 undefined。
export async function readBodyForLog(request) {
  const method = request.method
  if (method === 'GET' || method === 'OPTIONS') return undefined
  try {
    const cloned = request.clone()
    const text = await cloned.text()
    if (!text) return undefined
    return redact(JSON.parse(text))
  } catch {
    return '<unparseable>'
  }
}

// 生成短请求 ID(无 Math.random 依赖,用时间+计数器组合,不含横杠)
let counter = 0
export function genRequestId() {
  counter = (counter + 1) % 100000
  return `${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}`
}

// 从 Authorization 头里best-effort 取出 userId,仅用于日志标注(不验签,验签由 verifyAuth 负责)。
// 取不到/畸形一律返回 undefined,绝不抛错影响主流程。
export function peekUserId(request) {
  try {
    const token = (request.headers.get('Authorization') || '').replace('Bearer ', '')
    if (!token) return undefined
    const body = token.split('.')[1]
    if (!body) return undefined
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return payload.userId
  } catch {
    return undefined
  }
}

// 慢请求阈值(毫秒):超过则在日志打 slow 标记,便于筛查性能问题
const SLOW_MS = 1000

// 输出一条请求日志(结构化 JSON,便于检索)
export function logRequest({ reqId, userId, desc, method, pathname, query, body, code, message, status, durationMs, error }) {
  // 级别:异常 -> error;业务失败(code!=200)-> warn;其余 info
  const level = error ? 'error' : (code && code !== 200 ? 'warn' : 'info')
  const entry = {
    time: new Date().toISOString(),
    level,
    reqId,
    userId: userId || undefined, // 已登录请求才有;游客/未授权为 undefined
    desc,
    method,
    path: pathname,
    query: query && Object.keys(query).length ? query : undefined,
    reqBody: body,
    status,
    resCode: code,
    resMessage: message,
    durationMs,
    slow: durationMs >= SLOW_MS ? true : undefined,
    error: error ? (error.stack || String(error)) : undefined,
  }
  // 报错走 error 级别,其余 info
  if (level === 'error' || level === 'warn') {
    console.error('[REQ]', JSON.stringify(entry))
  } else {
    console.log('[REQ]', JSON.stringify(entry))
  }
}
