// /api 路由:菜单、个人资料、帖子与评论。Hono 子应用。
// 公开接口直接挂;需登录接口加 authRequired 中间件,handler 用 c.get('userId') 取当前用户。
import { Hono } from 'hono'
import { hashPassword, verifyPassword, signJWT, genId, bumpTokenVersion, verifyAuth } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { LIMITS, requireText, optionalText, escapeLike } from '../validate.js'
import { authRequired } from '../middleware.js'
import { rateLimit } from '../ratelimit.js'

// 服务类型菜单:前端 Home 的 Tab 与 CreatePost 的类型卡片都从这里取,
// 保证菜单由后端统一维护(增删服务类型无需改前端)。
const MENUS = [
  { value: 'help',  label: '求助互助', icon: '🙋', desc: '需要邻居帮忙',     color: 'warning' },
  { value: 'idle',  label: '闲置转让', icon: '📦', desc: '转让或免费赠送',   color: 'info' },
  { value: 'lost',  label: '失物招领', icon: '🔍', desc: '丢东西或捡到东西', color: 'error' },
  { value: 'group', label: '拼单拼团', icon: '🛒', desc: '一起拼外卖或团购', color: 'success' },
]

const bodyOf = async (c) => { try { return await c.req.json() } catch { return {} } }

// 内容发布限流:同一用户 1 分钟内最多发 5 条(发帖与评论共用一套窗口参数,各自独立计数)
const POST_RL_LIMIT = 5
const POST_RL_WINDOW_MS = 60 * 1000

const api = new Hono()

// ===== 公开接口 =====

// POST /api/menus/list —— 服务类型菜单
api.post('/menus/list', () => success(MENUS))

// POST /api/posts/list —— 帖子列表,参数 { type, page, keyword } 走 body
// 返回 { list, total, page, hasMore }:前端据此翻页/触底加载,无需再靠"返回条数==页大小"猜测。
api.post('/posts/list', async (c) => {
  const { type, page: rawPage, keyword } = await bodyOf(c)
  const page = Math.max(1, parseInt(rawPage || '1') || 1)
  const limit = 20
  const offset = (page - 1) * limit

  // 动态拼 WHERE:类型筛选 + 关键词(标题/内容)模糊搜索
  const where = []
  const args = []
  if (type) {
    where.push('p.type = ?')
    args.push(type)
  }
  const kw = (keyword || '').trim()
  if (kw) {
    // 转义 LIKE 通配符,避免用户输入的 % _ \ 被当作模式匹配
    const esc = escapeLike(kw)
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')")
    args.push(`%${esc}%`, `%${esc}%`)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

  // last_reply_at:该帖最近一条评论时间,无评论时为 NULL,前端据此显示"最近回复/发布"时间
  const listSql = `SELECT p.*, u.nickname, u.building, u.unit, (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count, (SELECT MAX(created_at) FROM comments WHERE post_id=p.id) AS last_reply_at FROM posts p JOIN users u ON p.user_id=u.id ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  const countSql = `SELECT COUNT(*) AS n FROM posts p ${whereSql}`

  const [{ results: list }, countRow] = await Promise.all([
    c.env.DB.prepare(listSql).bind(...args, limit, offset).all(),
    c.env.DB.prepare(countSql).bind(...args).first(),
  ])

  const total = countRow?.n ?? 0
  return success({ list, total, page, hasMore: offset + list.length < total })
})

// POST /api/posts/detail —— 帖子详情,参数 { id } 走 body
api.post('/posts/detail', async (c) => {
  const { id } = await bodyOf(c)
  const post = await c.env.DB.prepare(
    'SELECT p.*, u.nickname, u.building, u.unit FROM posts p JOIN users u ON p.user_id=u.id WHERE p.id=?'
  ).bind(id).first()
  if (!post) return fail(CODE.POST_NOT_FOUND, '帖子不存在')
  const { results: comments } = await c.env.DB.prepare(
    'SELECT c.*, u.nickname, u.building FROM comments c JOIN users u ON c.user_id=u.id WHERE c.post_id=? ORDER BY c.created_at ASC'
  ).bind(id).all()
  // 已采纳的帮助者(完成帖会有)
  const { results: helpers } = await c.env.DB.prepare(
    'SELECT h.helper_id, h.thanked, u.nickname, u.building FROM post_helpers h JOIN users u ON u.id=h.helper_id WHERE h.post_id=? ORDER BY h.created_at ASC'
  ).bind(id).all()
  // 响应者(公开展示)+ 当前用户是否已响应
  const { results: responses } = await c.env.DB.prepare(
    'SELECT r.user_id, u.nickname, u.building FROM post_responses r JOIN users u ON u.id=r.user_id WHERE r.post_id=? ORDER BY r.created_at ASC'
  ).bind(id).all()
  // 可选鉴权:解析当前用户(未登录则为 null),用于标记 myResponded
  const auth = await verifyAuth(c.req.raw, c.env)
  const myId = auth?.userId || null
  const myResponded = myId ? (responses || []).some(r => r.user_id === myId) : false
  return success({ ...post, comments, helpers, responses, myResponded })
})

// ===== 需登录接口(authRequired 中间件)=====

// POST /api/me/get —— 当前用户信息
api.post('/me/get', authRequired, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB.prepare('SELECT id, username, openid, nickname, avatar, building, unit, created_at FROM users WHERE id = ?').bind(userId).first()
  return success(user)
})

// POST /api/me/update —— 更新个人资料
api.post('/me/update', authRequired, async (c) => {
  const userId = c.get('userId')
  const { building, unit, nickname } = await bodyOf(c)
  const nick = optionalText(nickname, LIMITS.nickname, '昵称')
  if (!nick.ok) return fail(CODE.INVALID_INPUT, nick.message)
  const bld = optionalText(building, LIMITS.building, '楼栋')
  if (!bld.ok) return fail(CODE.INVALID_INPUT, bld.message)
  const ut = optionalText(unit, LIMITS.unit, '单元/门牌')
  if (!ut.ok) return fail(CODE.INVALID_INPUT, ut.message)
  await c.env.DB.prepare('UPDATE users SET building=?, unit=?, nickname=? WHERE id=?')
    .bind(bld.value, ut.value, nick.value, userId).run()
  return success({ success: true })
})

// POST /api/me/password —— 修改密码
api.post('/me/password', authRequired, async (c) => {
  const env = c.env
  const userId = c.get('userId')
  const { oldPassword, newPassword } = await bodyOf(c)
  if (!oldPassword || !newPassword) {
    return fail(CODE.INVALID_INPUT, '请填写旧密码和新密码')
  }
  if (newPassword.length < 6) {
    return fail(CODE.INVALID_INPUT, '新密码至少6位')
  }
  const user = await env.DB.prepare('SELECT id, password FROM users WHERE id = ?').bind(userId).first()
  if (!user || !user.password) {
    return fail(CODE.NO_PASSWORD_SET, '当前账号未设置密码,无法修改')
  }
  const valid = await verifyPassword(oldPassword, user.password)
  if (!valid) {
    return fail(CODE.WRONG_OLD_PASSWORD, '旧密码错误')
  }
  const hashed = await hashPassword(newPassword)
  // 改密码同时 token_version+1:吊销此前签发的所有 token(其它设备需重新登录);
  // 并为当前会话签发携带新版本的 token,避免用户改完密码立刻被自己登出。
  const newVersion = await bumpTokenVersion(env, userId)
  await env.DB.prepare('UPDATE users SET password=? WHERE id=?').bind(hashed, userId).run()
  const token = await signJWT({ userId, tv: newVersion }, env.JWT_SECRET)
  return success({ token })
})

// POST /api/me/logout —— 退出登录:token_version+1 吊销所有已签发 token
api.post('/me/logout', authRequired, async (c) => {
  await bumpTokenVersion(c.env, c.get('userId'))
  return success({ success: true })
})

// POST /api/me/posts —— 我发布的帖子,参数 { page, status } 走 body,返回 { list, total, page, hasMore }// status 取 'open'/'closed',其余值(含空)表示全部
api.post('/me/posts', authRequired, async (c) => {
  const userId = c.get('userId')
  const { page: rawPage, status } = await bodyOf(c)
  const page = Math.max(1, parseInt(rawPage || '1') || 1)
  const limit = 20
  const offset = (page - 1) * limit

  const where = ['p.user_id = ?']
  const args = [userId]
  if (status === 'open' || status === 'closed') {
    where.push('p.status = ?')
    args.push(status)
  }
  const whereSql = 'WHERE ' + where.join(' AND ')

  const [{ results: list }, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count FROM posts p ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...args, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p ${whereSql}`).bind(...args).first(),
  ])

  const total = countRow?.n ?? 0
  return success({ list, total, page, hasMore: offset + list.length < total })
})

// POST /api/me/stats —— 个人页数据统计(基于采纳记录 post_helpers)
//   helped:   我被别人采纳为帮助者的次数(我真的帮了邻居,且被点名)
//   received: 我的帖子里采纳帮助者的条数(我得到的有效帮助)
api.post('/me/stats', authRequired, async (c) => {
  const userId = c.get('userId')
  const [helped, received] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM post_helpers WHERE helper_id = ?').bind(userId).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM post_helpers h JOIN posts p ON p.id = h.post_id WHERE p.user_id = ?`
    ).bind(userId).first(),
  ])
  return success({ helped: helped?.n ?? 0, received: received?.n ?? 0 })
})

// POST /api/posts/create —— 发布帖子
api.post('/posts/create', authRequired, async (c) => {
  const userId = c.get('userId')
  // 限流:防刷帖
  const rl = await rateLimit(c.env, `post:${userId}`, POST_RL_LIMIT, POST_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `发布过于频繁,请${rl.retryAfter}秒后再试`)
  const { type, title, content, images, contact, location } = await bodyOf(c)
  // type 必须是已知菜单值
  if (!type || !MENUS.some(m => m.value === type)) {
    return fail(CODE.POST_MISSING_FIELD, '请选择有效的服务类型')
  }
  const t = requireText(title, LIMITS.title, '标题')
  if (!t.ok) return fail(CODE.POST_MISSING_FIELD, t.message)
  const ct = optionalText(content, LIMITS.content, '内容')
  if (!ct.ok) return fail(CODE.INVALID_INPUT, ct.message)
  const cont = optionalText(contact, LIMITS.contact, '联系方式')
  if (!cont.ok) return fail(CODE.INVALID_INPUT, cont.message)
  const loc = optionalText(location, LIMITS.location, '位置')
  if (!loc.ok) return fail(CODE.INVALID_INPUT, loc.message)
  // 位置默认带入发帖人资料的楼栋单元(用户未填时)
  let locValue = loc.value
  if (!locValue) {
    const me = await c.env.DB.prepare('SELECT building, unit FROM users WHERE id=?').bind(userId).first()
    locValue = [me?.building, me?.unit].filter(Boolean).join(' ')
  }
  const id = genId()
  await c.env.DB.prepare(
    'INSERT INTO posts (id, user_id, type, title, content, images, contact, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, type, t.value, ct.value, JSON.stringify(images || []), cont.value, locValue, Date.now()).run()
  return success({ id })
})

// POST /api/posts/update —— 编辑帖子(仅作者、仅 open 状态),参数 { id, type, title, content, images }
api.post('/posts/update', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id, type, title, content, images, contact, location } = await bodyOf(c)
  // 先取帖子,校验归属与状态
  const post = await c.env.DB.prepare('SELECT user_id, status FROM posts WHERE id = ?').bind(id).first()
  if (!post || post.user_id !== userId) return fail(CODE.POST_NOT_FOUND, '帖子不存在或无权操作')
  if (post.status !== 'open') return fail(CODE.POST_MISSING_FIELD, '已完成的帖子不可编辑')
  // 字段校验与发帖一致
  if (!type || !MENUS.some(m => m.value === type)) {
    return fail(CODE.POST_MISSING_FIELD, '请选择有效的服务类型')
  }
  const t = requireText(title, LIMITS.title, '标题')
  if (!t.ok) return fail(CODE.POST_MISSING_FIELD, t.message)
  const ct = optionalText(content, LIMITS.content, '内容')
  if (!ct.ok) return fail(CODE.INVALID_INPUT, ct.message)
  const cont = optionalText(contact, LIMITS.contact, '联系方式')
  if (!cont.ok) return fail(CODE.INVALID_INPUT, cont.message)
  const loc = optionalText(location, LIMITS.location, '位置')
  if (!loc.ok) return fail(CODE.INVALID_INPUT, loc.message)
  await c.env.DB.prepare('UPDATE posts SET type=?, title=?, content=?, images=?, contact=?, location=? WHERE id=? AND user_id=?')
    .bind(type, t.value, ct.value, JSON.stringify(images || []), cont.value, loc.value, id, userId).run()
  return success({ id })
})

// POST /api/posts/comment —— 发表评论,参数 { id, content } 走 body
api.post('/posts/comment', authRequired, async (c) => {
  const userId = c.get('userId')
  // 限流:防刷评论
  const rl = await rateLimit(c.env, `comment:${userId}`, POST_RL_LIMIT, POST_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `评论过于频繁,请${rl.retryAfter}秒后再试`)
  const { id, content } = await bodyOf(c)
  const ct = requireText(content, LIMITS.comment, '评论内容')
  if (!ct.ok) return fail(CODE.COMMENT_EMPTY, ct.message)
  // 校验帖子存在,避免对不存在的 id 插入孤儿评论;同时取作者以便写通知
  const post = await c.env.DB.prepare('SELECT id, user_id FROM posts WHERE id = ?').bind(id).first()
  if (!post) return fail(CODE.POST_NOT_FOUND, '帖子不存在')
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO comments (id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(genId(), id, userId, ct.value, now).run()
  // 评论非自己帖子时,给作者写一条通知(自己评自己的帖不通知)
  if (post.user_id !== userId) {
    await c.env.DB.prepare(
      'INSERT INTO notifications (id, user_id, type, post_id, actor_id, content, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(genId(), post.user_id, 'comment', id, userId, ct.value, now).run()
  }
  return success({ success: true })
})

// POST /api/posts/helpers/candidates —— 采纳候选人。
// 候选人 = 本帖「响应者」(点过我要帮忙/我想要/这是我的)∪「评论者」(回复过帖子的人),按最早交互时间排序、去重、排除帖主。
// 仅帖主可查。参数 { id }。返回 [{ id, nickname, building }]
api.post('/posts/helpers/candidates', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id } = await bodyOf(c)
  const post = await c.env.DB.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first()
  if (!post || post.user_id !== userId) return fail(CODE.POST_NOT_FOUND, '帖子不存在或无权操作')

  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS uid, u.nickname, u.building, MIN(x.ts) AS first_ts
     FROM (
       SELECT user_id AS uid, created_at AS ts FROM post_responses WHERE post_id = ?1
       UNION ALL
       SELECT user_id AS uid, created_at AS ts FROM comments WHERE post_id = ?1
     ) x
     JOIN users u ON u.id = x.uid
     WHERE x.uid != ?2
     GROUP BY u.id
     ORDER BY first_ts ASC`
  ).bind(id, userId).all()
  const candidates = (results || []).map(r => ({ id: r.uid, nickname: r.nickname || '邻居', building: r.building || '' }))
  return success({ candidates })
})

// POST /api/posts/respond —— 响应帖子(我要帮忙/我想要/这是我的),参数 { id }
// 仅 求助/闲置/失物 可响应;排除帖主;同一用户对同一帖只记一次(UNIQUE 冲突即视为已响应)。
api.post('/posts/respond', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id } = await bodyOf(c)
  const post = await c.env.DB.prepare('SELECT user_id, type, status FROM posts WHERE id = ?').bind(id).first()
  if (!post) return fail(CODE.POST_NOT_FOUND, '帖子不存在')
  if (post.user_id === userId) return fail(CODE.POST_MISSING_FIELD, '不能响应自己的帖子')
  if (!['help', 'idle', 'lost'].includes(post.type)) return fail(CODE.POST_MISSING_FIELD, '该类型帖子不支持响应')
  if (post.status !== 'open') return fail(CODE.POST_MISSING_FIELD, '该帖已完成')
  // INSERT OR IGNORE:已响应过则静默成功(幂等)
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO post_responses (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)'
  ).bind(genId(), id, userId, Date.now()).run()
  return success({ success: true })
})

// POST /api/posts/unrespond —— 取消响应,参数 { id }。幂等:未响应过也返回成功。
api.post('/posts/unrespond', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id } = await bodyOf(c)
  await c.env.DB.prepare('DELETE FROM post_responses WHERE post_id = ? AND user_id = ?')
    .bind(id, userId).run()
  return success({ success: true })
})

// POST /api/posts/close —— 标记帖子完成,参数 { id, helpers? }
// helpers: [{ helperId, thanked }] 采纳的帮助者(可空=纯关帖)。thanked=1 额外发感谢通知。
api.post('/posts/close', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id, helpers } = await bodyOf(c)

  // 校验帖子归属与状态(必须是自己的、且未完成)
  const post = await c.env.DB.prepare('SELECT user_id, title, status FROM posts WHERE id = ?').bind(id).first()
  if (!post || post.user_id !== userId) return fail(CODE.POST_NOT_FOUND, '帖子不存在或无权操作')

  // 采纳者校验:必须是本帖响应者或评论者,排除自己;去重
  const picked = Array.isArray(helpers) ? helpers : []
  let validHelpers = []
  if (picked.length) {
    const { results: cand } = await c.env.DB.prepare(
      `SELECT DISTINCT uid FROM (
         SELECT user_id AS uid FROM post_responses WHERE post_id = ?1
         UNION SELECT user_id AS uid FROM comments WHERE post_id = ?1
       ) WHERE uid != ?2`
    ).bind(id, userId).all()
    const allow = new Set((cand || []).map(r => r.uid))
    const seen = new Set()
    for (const h of picked) {
      const hid = h?.helperId
      if (hid && hid !== userId && allow.has(hid) && !seen.has(hid)) {
        seen.add(hid)
        validHelpers.push({ helperId: hid, thanked: h.thanked ? 1 : 0 })
      }
    }
  }

  // 关帖(仅在 open→closed 时计为有效变更)
  const { meta } = await c.env.DB.prepare('UPDATE posts SET status="closed" WHERE id=? AND user_id=? AND status="open"')
    .bind(id, userId).run()
  if (!meta.changes) return fail(CODE.POST_NOT_FOUND, '帖子不存在、已完成或无权操作')

  // 写采纳记录 + 通知。被采纳本身即发通知(adopt);额外感谢则用 thank(措辞更重)。
  const now = Date.now()
  for (const h of validHelpers) {
    await c.env.DB.prepare(
      'INSERT INTO post_helpers (id, post_id, helper_id, thanked, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(genId(), id, h.helperId, h.thanked, now).run()
    await c.env.DB.prepare(
      'INSERT INTO notifications (id, user_id, type, post_id, actor_id, content, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(genId(), h.helperId, h.thanked ? 'thank' : 'adopt', id, userId, post.title || '', now).run()
  }
  return success({ success: true, adopted: validHelpers.length })
})

// POST /api/posts/delete —— 删除帖子(仅本人),参数 { id } 走 body
// D1 外键不保证级联,这里应用层先删评论再删帖子,避免遗留孤儿评论。
api.post('/posts/delete', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id } = await bodyOf(c)
  const { meta } = await c.env.DB.prepare('DELETE FROM posts WHERE id=? AND user_id=?')
    .bind(id, userId).run()
  if (!meta.changes) return fail(CODE.POST_NOT_FOUND, '帖子不存在或无权操作')
  await c.env.DB.prepare('DELETE FROM comments WHERE post_id=?').bind(id).run()
  return success({ success: true })
})

// POST /api/posts/comment/delete —— 删除评论(仅本人),参数 { id } 走 body(评论 id)
api.post('/posts/comment/delete', authRequired, async (c) => {
  const userId = c.get('userId')
  const { id } = await bodyOf(c)
  const { meta } = await c.env.DB.prepare('DELETE FROM comments WHERE id=? AND user_id=?')
    .bind(id, userId).run()
  if (!meta.changes) return fail(CODE.COMMENT_NOT_FOUND, '评论不存在或无权操作')
  return success({ success: true })
})

export default api
