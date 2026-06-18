// /api 私信与通知路由。全部需登录。
// 设计:消息列表(inbox)把"私信会话"与"评论通知"合并成一条按时间倒序的统一流,
// 前端按 kind 区分渲染(私信显示对方昵称/头像,评论显示帖子标题与评论内容)。
import { Hono } from 'hono'
import { genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { LIMITS, requireText } from '../validate.js'
import { authRequired } from '../middleware.js'
import { rateLimit } from '../ratelimit.js'

const bodyOf = async (c) => { try { return await c.req.json() } catch { return {} } }

// 私信发送限流:同发帖,1 分钟 5 条(独立计数)
const MSG_RL_LIMIT = 5
const MSG_RL_WINDOW_MS = 60 * 1000

const messages = new Hono()

// 所有接口需登录
messages.use('*', authRequired)

// POST /api/messages/send —— 发私信,参数 { receiverId, postId?, content }
messages.post('/messages/send', async (c) => {
  const userId = c.get('userId')
  const rl = await rateLimit(c.env, `msg:${userId}`, MSG_RL_LIMIT, MSG_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `发送过于频繁,请${rl.retryAfter}秒后再试`)

  const { receiverId, postId, content } = await bodyOf(c)
  const ct = requireText(content, LIMITS.message, '消息内容')
  if (!ct.ok) return fail(CODE.MESSAGE_EMPTY, ct.message)
  // 不能发给自己;对端必须存在
  if (!receiverId || receiverId === userId) return fail(CODE.MESSAGE_BAD_TARGET, '私信对象无效')
  const peer = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(receiverId).first()
  if (!peer) return fail(CODE.MESSAGE_BAD_TARGET, '私信对象不存在')

  const id = genId()
  await c.env.DB.prepare(
    'INSERT INTO messages (id, sender_id, receiver_id, post_id, content, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).bind(id, userId, receiverId, postId || null, ct.value, Date.now()).run()
  return success({ id })
})

// POST /api/messages/thread —— 与某人的聊天记录,参数 { peerId, page }
// 拉取时把对方发给我、且未读的消息标为已读。返回按时间正序(便于聊天从上到下渲染)。
messages.post('/messages/thread', async (c) => {
  const userId = c.get('userId')
  const { peerId, page: rawPage } = await bodyOf(c)
  if (!peerId) return fail(CODE.MESSAGE_BAD_TARGET, '会话对象无效')
  const page = Math.max(1, parseInt(rawPage || '1') || 1)
  const limit = 30
  const offset = (page - 1) * limit

  const peer = await c.env.DB.prepare(
    'SELECT id, nickname, avatar, building, unit FROM users WHERE id = ?'
  ).bind(peerId).first()
  if (!peer) return fail(CODE.MESSAGE_BAD_TARGET, '会话对象不存在')

  // 先标记已读:对方发给我的未读消息
  await c.env.DB.prepare(
    'UPDATE messages SET read = 1 WHERE receiver_id = ? AND sender_id = ? AND read = 0'
  ).bind(userId, peerId).run()

  // 两人之间双向消息,取最近 limit 条(倒序取再正序返回)
  const { results } = await c.env.DB.prepare(
    `SELECT id, sender_id, receiver_id, content, created_at FROM messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, peerId, peerId, userId, limit, offset).all()
  const list = (results || []).reverse()

  return success({ peer, list, page, hasMore: results.length === limit })
})

// POST /api/messages/inbox —— 统一消息列表:私信会话 + 评论通知,按时间倒序混排
// 私信会话:每个对话对象取最新一条 + 未读数;评论通知:每条带帖子标题与评论人昵称。
messages.post('/messages/inbox', async (c) => {
  const userId = c.get('userId')

  // 1) 私信会话:窗口函数按对方分组取最新一条
  const convSql = `
    WITH conv AS (
      SELECT
        CASE WHEN sender_id = ?1 THEN receiver_id ELSE sender_id END AS peer_id,
        content, created_at, sender_id,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN sender_id = ?1 THEN receiver_id ELSE sender_id END
          ORDER BY created_at DESC
        ) AS rn
      FROM messages
      WHERE sender_id = ?1 OR receiver_id = ?1
    )
    SELECT c.peer_id, c.content, c.created_at, c.sender_id,
           u.nickname AS peer_name, u.avatar AS peer_avatar, u.building AS peer_building,
           (SELECT COUNT(*) FROM messages m WHERE m.receiver_id = ?1 AND m.sender_id = c.peer_id AND m.read = 0) AS unread
    FROM conv c JOIN users u ON u.id = c.peer_id
    WHERE c.rn = 1`

  // 2) 评论通知
  const notiSql = `
    SELECT n.id, n.type, n.post_id, n.content, n.read, n.created_at,
           p.title AS post_title, a.nickname AS actor_name
    FROM notifications n
    LEFT JOIN posts p ON p.id = n.post_id
    LEFT JOIN users a ON a.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT 100`

  const [{ results: convs }, { results: notis }] = await Promise.all([
    c.env.DB.prepare(convSql).bind(userId).all(),
    c.env.DB.prepare(notiSql).bind(userId).all(),
  ])

  // 统一成同构条目,kind 区分类型
  const items = [
    ...(convs || []).map(r => ({
      kind: 'message',
      peerId: r.peer_id,
      peerName: r.peer_name || '邻居',
      peerAvatar: r.peer_avatar || null,
      peerBuilding: r.peer_building || '',
      content: r.content,
      fromMe: r.sender_id === userId,    // 最新一条是不是我发的
      unread: r.unread || 0,
      createdAt: r.created_at,
    })),
    ...(notis || []).map(r => ({
      kind: 'comment',
      notificationId: r.id,
      postId: r.post_id,
      postTitle: r.post_title || '(帖子已删除)',
      actorName: r.actor_name || '邻居',
      content: r.content || '',
      read: r.read === 1,
      createdAt: r.created_at,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt)

  return success({ items })
})

// POST /api/messages/unread —— 总未读数(私信未读 + 通知未读),给首页角标轮询用
messages.post('/messages/unread', async (c) => {
  const userId = c.get('userId')
  const [m, n] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND read = 0').bind(userId).first(),
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').bind(userId).first(),
  ])
  const messageUnread = m?.c ?? 0
  const notiUnread = n?.c ?? 0
  return success({ total: messageUnread + notiUnread, messageUnread, notiUnread })
})

// POST /api/notifications/read —— 标记通知已读,参数 { id }(不传则全部已读)
messages.post('/notifications/read', async (c) => {
  const userId = c.get('userId')
  const { id } = await bodyOf(c)
  if (id) {
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').bind(id, userId).run()
  } else {
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').bind(userId).run()
  }
  return success({ success: true })
})

export default messages
