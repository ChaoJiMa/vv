// Hono 应用入口:CORS + 日志中间件 + 错误兜底,挂载 /auth 与 /api 两个子路由。
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logging } from './middleware.js'
import { fail, CODE } from './response.js'
import authRoutes from './routes/auth.js'
import apiRoutes from './routes/posts.js'
import messageRoutes from './routes/messages.js'
import reportRoutes from './routes/reports.js'
import imageRoutes from './routes/images.js'

// 允许的来源:本地开发 + Pages 域名(含每次部署的预览子域名)
function resolveCorsOrigin(origin) {
  const ok =
    origin === 'http://localhost:5173' ||
    origin === 'http://127.0.0.1:5173' ||
    origin === 'https://neighbor-help.pages.dev' ||
    /^https:\/\/[a-z0-9-]+\.neighbor-help\.pages\.dev$/.test(origin)
  return ok ? origin : 'https://neighbor-help.pages.dev'
}

const app = new Hono()

// CORS:动态校验来源(含预览子域名),自动处理 OPTIONS 预检
app.use('*', cors({
  origin: (origin) => resolveCorsOrigin(origin || ''),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// 请求日志(入参/出参/耗时/报错)
app.use('*', logging)

// 业务路由
// 注意挂载顺序:messages/reports 内部用 `use('*', authRequired)` 注册了 /api/* 级中间件。
// Hono 按注册顺序组合匹配的中间件,故含「公开路由」的子应用(posts 的列表/详情、images 的
// GET /api/img)必须挂在这两个鉴权子应用「之前」,否则其公开路由会被 authRequired 拦成 401。
app.route('/auth', authRoutes)
app.route('/api', apiRoutes)
app.route('/api', imageRoutes)
app.route('/api', messageRoutes)
app.route('/api', reportRoutes)

// 未命中路由
app.notFound(() => fail(CODE.NOT_FOUND, '接口不存在'))

// 错误兜底:不向客户端泄露内部细节,异常详情由日志中间件记录
app.onError(() => fail(CODE.SERVER_ERROR, '服务器内部错误'))

export default app
