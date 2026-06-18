// /auth 路由:注册、登录、微信登录。Hono 子应用。
import { Hono } from 'hono'
import { hashPassword, verifyPassword, signJWT, genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { LIMITS, optionalText } from '../validate.js'
import { rateLimit, resetRateLimit } from '../ratelimit.js'

// 登录/注册限流参数:同一 IP 10 分钟内最多 10 次尝试
const RL_LIMIT = 10
const RL_WINDOW_MS = 10 * 60 * 1000

const clientIp = (c) => c.req.header('CF-Connecting-IP') || 'unknown'
const bodyOf = async (c) => { try { return await c.req.json() } catch { return {} } }

const auth = new Hono()

// POST /auth/register —— 用户名密码注册
auth.post('/register', async (c) => {
  const env = c.env
  // 限流:防批量注册
  const rl = await rateLimit(env, `register:${clientIp(c)}`, RL_LIMIT, RL_WINDOW_MS)
  if (rl.limited) {
    return fail(CODE.TOO_MANY_REQUESTS, `操作过于频繁,请${rl.retryAfter}秒后再试`)
  }

  const { username, password, nickname, building, unit } = await bodyOf(c)
  if (!username || !password) {
    return fail(CODE.INVALID_INPUT, '用户名和密码不能为空')
  }
  // 用户名:4-20 位字母或数字
  if (!/^[a-zA-Z0-9]{4,20}$/.test(username)) {
    return fail(CODE.INVALID_INPUT, '用户名需为4-20位字母或数字')
  }
  // 密码:至少 8 位
  if (password.length < 8) {
    return fail(CODE.INVALID_INPUT, '密码至少8位')
  }
  if (password.length > LIMITS.password) {
    return fail(CODE.INVALID_INPUT, '密码过长')
  }
  const nick = optionalText(nickname, LIMITS.nickname, '昵称')
  if (!nick.ok) return fail(CODE.INVALID_INPUT, nick.message)
  const bld = optionalText(building, LIMITS.building, '楼栋')
  if (!bld.ok) return fail(CODE.INVALID_INPUT, bld.message)
  const ut = optionalText(unit, LIMITS.unit, '单元')
  if (!ut.ok) return fail(CODE.INVALID_INPUT, ut.message)

  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()
  if (exists) {
    return fail(CODE.USERNAME_TAKEN, '用户名已被注册')
  }

  const hashed = await hashPassword(password)
  const id = genId()
  await env.DB.prepare(
    'INSERT INTO users (id, username, password, nickname, building, unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, username, hashed, nick.value || username, bld.value, ut.value, Date.now()).run()

  const user = await env.DB.prepare('SELECT id, username, nickname, avatar, building, unit FROM users WHERE id = ?')
    .bind(id).first()
  const token = await signJWT({ userId: user.id, tv: 0 }, env.JWT_SECRET)
  return success({ token, user })
})

// POST /auth/login —— 用户名密码登录
auth.post('/login', async (c) => {
  const env = c.env
  // 限流:防暴力破解。按 IP 计数,失败累加,成功则清零。
  const rlKey = `login:${clientIp(c)}`
  const rl = await rateLimit(env, rlKey, RL_LIMIT, RL_WINDOW_MS)
  if (rl.limited) {
    return fail(CODE.TOO_MANY_REQUESTS, `登录尝试过于频繁,请${rl.retryAfter}秒后再试`)
  }

  const { username, password } = await bodyOf(c)
  if (!username || !password) {
    return fail(CODE.INVALID_INPUT, '用户名和密码不能为空')
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first()
  if (!user || !user.password) {
    return fail(CODE.INVALID_CREDENTIALS, '用户名或密码错误')
  }
  const valid = await verifyPassword(password, user.password)
  if (!valid) {
    return fail(CODE.INVALID_CREDENTIALS, '用户名或密码错误')
  }

  // 登录成功:清除该 IP 的失败计数
  await resetRateLimit(env, rlKey)
  const token = await signJWT({ userId: user.id, tv: user.token_version ?? 0 }, env.JWT_SECRET)
  const { password: _, ...safeUser } = user
  return success({ token, user: safeUser })
})

// POST /auth/wechat —— 微信 OAuth 登录(可选)
auth.post('/wechat', async (c) => {
  const env = c.env
  // 未配置微信密钥时直接拒绝,避免把 undefined 拼进微信 API URL 发出无意义请求
  if (!env.WX_APPID || !env.WX_SECRET) {
    return fail(CODE.WECHAT_FAILED, '本站未开启微信登录')
  }
  const { code } = await bodyOf(c)
  if (!code) {
    return fail(CODE.INVALID_INPUT, '缺少 code 参数')
  }

  // 用 code 换 openid
  const wxRes = await fetch(
    `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${env.WX_APPID}&secret=${env.WX_SECRET}&code=${code}&grant_type=authorization_code`
  )
  const wxData = await wxRes.json()
  if (wxData.errcode) {
    return fail(CODE.WECHAT_FAILED, wxData.errmsg || '微信授权失败')
  }

  const { openid, access_token } = wxData

  // 获取用户信息。拉取失败不阻断登录(openid 已拿到),仅退化为默认昵称/头像。
  const infoRes = await fetch(
    `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`
  )
  const info = await infoRes.json()
  const profile = info && !info.errcode ? info : {}

  // 查或建用户
  let user = await env.DB.prepare('SELECT * FROM users WHERE openid = ?').bind(openid).first()
  if (!user) {
    await env.DB.prepare(
      'INSERT INTO users (id, openid, nickname, avatar, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(genId(), openid, profile.nickname || '邻居', profile.headimgurl || '', Date.now()).run()
    user = await env.DB.prepare('SELECT * FROM users WHERE openid = ?').bind(openid).first()
  }

  const token = await signJWT({ userId: user.id, tv: user.token_version ?? 0, openid }, env.JWT_SECRET)
  const { password: _, ...safeUser } = user
  return success({ token, user: safeUser })
})

export default auth
