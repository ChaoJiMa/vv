// /api 私信与通知路由。全部需登录。
// 私信按「对方用户 + 帖子」拆会话(conversations)；通知仍独立列表。
import { Hono } from 'hono'
import { genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { LIMITS, requireText } from '../validate.js'
import { authRequired } from '../middleware.js'
import { rateLimit } from '../ratelimit.js'
import { findSensitive } from '../sensitive.js'
import { pairUsers, displayPostTitle, canOpenPostDm, EMPTY_CONV_TTL_MS } from '../conversation.js'

const bodyOf = async (c) => { try { return await c.req.json() } catch { return {} } }

const MSG_RL_LIMIT = 5
const MSG_RL_WINDOW_MS = 60 * 1000

/** 清掉当前用户参与的、超时仍无消息的空会话，避免 ensure 堆积 */
async function pruneEmptyConversations(db, userId, now = Date.now()) {
  const cutoff = now - EMPTY_CONV_TTL_MS
  await db.prepare(
    `DELETE FROM conversations
     WHERE last_message_at IS NULL AND created_at < ?
       AND (user_a = ? OR user_b = ?)`
  ).bind(cutoff, userId, userId).run()
}

const messages = new Hono()
messages.use('*', authRequired)

// POST /api/messages/ensure —— 按对方+帖 find-or-create 会话。参数 { receiverId, postId }
messages.post('/messages/ensure', async (c) => {
  const userId = c.get('userId')
  const rl = await rateLimit(c.env, `msg-ensure:${userId}`, 20, MSG_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `操作过于频繁,请${rl.retryAfter}秒后再试`)
  const { receiverId, postId } = await bodyOf(c)
  if (!receiverId || receiverId === userId) return fail(CODE.MESSAGE_BAD_TARGET, '私信对象无效')
  if (!postId) return fail(CODE.INVALID_INPUT, '须从帖子发起私信')

  const peer = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(receiverId).first()
  if (!peer) return fail(CODE.MESSAGE_BAD_TARGET, '私信对象不存在')

  const post = await c.env.DB.prepare('SELECT id, user_id, title FROM posts WHERE id = ?').bind(postId).first()
  if (!post) return fail(CODE.POST_NOT_FOUND, '帖子不存在')
  if (!canOpenPostDm(post.user_id, userId, receiverId)) {
    return fail(CODE.MESSAGE_BAD_TARGET, '只能与帖主发起该帖私信')
  }

  await pruneEmptyConversations(c.env.DB, userId)

  const [userA, userB] = pairUsers(userId, receiverId)
  const liveTitle = post.title || ''
  let conv = await c.env.DB.prepare(
    'SELECT id, post_id, post_title FROM conversations WHERE user_a=? AND user_b=? AND post_id=?'
  ).bind(userA, userB, postId).first()

  if (!conv) {
    const id = genId()
    const now = Date.now()
    // 并发 ensure 可能撞 UNIQUE: IGNORE 后回读
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO conversations (id, user_a, user_b, post_id, post_title, last_message_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, userA, userB, postId, liveTitle, null, now).run()
    conv = await c.env.DB.prepare(
      'SELECT id, post_id, post_title FROM conversations WHERE user_a=? AND user_b=? AND post_id=?'
    ).bind(userA, userB, postId).first()
    if (!conv) return fail(CODE.SERVER_ERROR, '创建会话失败')
  } else if ((conv.post_title || '') !== liveTitle) {
    // 帖标题变更时刷新快照，列表/顶栏与帖面一致
    await c.env.DB.prepare('UPDATE conversations SET post_title = ? WHERE id = ?')
      .bind(liveTitle, conv.id).run()
    conv = { ...conv, post_title: liveTitle }
  }

  return success({
    conversationId: conv.id,
    postId: conv.post_id,
    postTitle: displayPostTitle(conv.post_title, false),
    postDeleted: false,
  })
})

// POST /api/messages/send —— 发私信,参数 { conversationId, content }
messages.post('/messages/send', async (c) => {
  const userId = c.get('userId')
  const rl = await rateLimit(c.env, `msg:${userId}`, MSG_RL_LIMIT, MSG_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `发送过于频繁,请${rl.retryAfter}秒后再试`)

  const { conversationId, content } = await bodyOf(c)
  const ct = requireText(content, LIMITS.message, '消息内容')
  if (!ct.ok) return fail(CODE.MESSAGE_EMPTY, ct.message)
  const bad = await findSensitive(c.env, ct.value)
  if (bad) return fail(CODE.CONTENT_BLOCKED, `消息含违规词「${bad}」,请修改后再发`)
  if (!conversationId) return fail(CODE.MESSAGE_BAD_TARGET, '会话对象无效')

  const conv = await c.env.DB.prepare(
    'SELECT id, user_a, user_b, post_id FROM conversations WHERE id = ?'
  ).bind(conversationId).first()
  if (!conv || (conv.user_a !== userId && conv.user_b !== userId)) {
    return fail(CODE.MESSAGE_BAD_TARGET, '会话对象无效')
  }
  const receiverId = conv.user_a === userId ? conv.user_b : conv.user_a
  const now = Date.now()
  const id = genId()
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO messages (id, conversation_id, sender_id, receiver_id, post_id, content, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(id, conversationId, userId, receiverId, conv.post_id, ct.value, now),
    c.env.DB.prepare(
      'UPDATE conversations SET last_message_at = ? WHERE id = ?'
    ).bind(now, conversationId),
  ])
  return success({ id, conversationId })
})

// POST /api/messages/thread —— 某会话聊天记录,参数 { conversationId, page }
messages.post('/messages/thread', async (c) => {
  const userId = c.get('userId')
  const { conversationId, page: rawPage } = await bodyOf(c)
  if (!conversationId) return fail(CODE.MESSAGE_BAD_TARGET, '会话对象无效')
  const page = Math.max(1, parseInt(rawPage || '1') || 1)
  const limit = 30
  const offset = (page - 1) * limit

  const conv = await c.env.DB.prepare(
    `SELECT c.id, c.user_a, c.user_b, c.post_id, c.post_title, p.id AS live_post_id
     FROM conversations c
     LEFT JOIN posts p ON p.id = c.post_id
     WHERE c.id = ?`
  ).bind(conversationId).first()
  if (!conv || (conv.user_a !== userId && conv.user_b !== userId)) {
    return fail(CODE.MESSAGE_BAD_TARGET, '会话对象无效')
  }
  const peerId = conv.user_a === userId ? conv.user_b : conv.user_a
  const peer = await c.env.DB.prepare(
    'SELECT id, nickname, avatar, building, unit FROM users WHERE id = ?'
  ).bind(peerId).first()
  if (!peer) return fail(CODE.MESSAGE_BAD_TARGET, '会话对象不存在')

  const postDeleted = !conv.live_post_id
  await c.env.DB.prepare(
    'UPDATE messages SET read = 1 WHERE conversation_id = ? AND receiver_id = ? AND read = 0'
  ).bind(conversationId, userId).run()

  const { results } = await c.env.DB.prepare(
    `SELECT id, sender_id, receiver_id, content, created_at FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(conversationId, limit + 1, offset).all()
  const rows = results || []
  const hasMore = rows.length > limit
  const list = rows.slice(0, limit).reverse()

  return success({
    peer,
    conversationId: conv.id,
    postId: conv.post_id,
    postTitle: displayPostTitle(conv.post_title, postDeleted),
    postDeleted,
    list,
    page,
    hasMore,
  })
})

// POST /api/messages/conversations —— 私信会话列表(分页)
messages.post('/messages/conversations', async (c) => {
  const userId = c.get('userId')
  const { page: rawPage } = await bodyOf(c)
  const page = Math.max(1, parseInt(rawPage || '1') || 1)
  const limit = 20
  const offset = (page - 1) * limit

  const listSql = `
    SELECT c.id AS conversation_id, c.post_id, c.post_title, c.last_message_at, c.created_at, c.user_a, c.user_b,
           p.id AS live_post_id,
           CASE WHEN c.user_a = ?1 THEN c.user_b ELSE c.user_a END AS peer_id,
           (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS content,
           (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_sender_id,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.receiver_id = ?1 AND m.read = 0) AS unread
    FROM conversations c
    LEFT JOIN posts p ON p.id = c.post_id
    WHERE (c.user_a = ?1 OR c.user_b = ?1)
      AND c.last_message_at IS NOT NULL
    ORDER BY c.last_message_at DESC
    LIMIT ?2 OFFSET ?3`
  // 仅展示已有消息的会话,避免对方点「私信」后己方列表出现空会话噪音
  const countSql = `
    SELECT COUNT(*) AS n FROM conversations
    WHERE (user_a = ? OR user_b = ?) AND last_message_at IS NOT NULL`

  const [{ results: convs }, countRow] = await Promise.all([
    c.env.DB.prepare(listSql).bind(userId, limit, offset).all(),
    c.env.DB.prepare(countSql).bind(userId, userId).first(),
  ])

  const peerIds = [...new Set((convs || []).map(r => r.peer_id))]
  const peerMap = {}
  if (peerIds.length) {
    const placeholders = peerIds.map(() => '?').join(',')
    const { results: peers } = await c.env.DB.prepare(
      `SELECT id, nickname, avatar, building FROM users WHERE id IN (${placeholders})`
    ).bind(...peerIds).all()
    for (const u of peers || []) peerMap[u.id] = u
  }

  const list = (convs || []).map(r => {
    const postDeleted = !r.live_post_id
    const u = peerMap[r.peer_id]
    return {
      conversationId: r.conversation_id,
      peerId: r.peer_id,
      peerName: u?.nickname || '邻居',
      peerAvatar: u?.avatar || null,
      peerBuilding: u?.building || '',
      postId: r.post_id,
      postTitle: displayPostTitle(r.post_title, postDeleted),
      postDeleted,
      content: r.content || '',
      fromMe: r.last_sender_id === userId,
      unread: r.unread || 0,
      createdAt: r.last_message_at || r.created_at || null,
    }
  })
  const total = countRow?.n ?? 0
  return success({ list, total, page, hasMore: offset + list.length < total })
})

// POST /api/notifications/list —— 通知列表(分页)。参数 { page }。
messages.post('/notifications/list', async (c) => {
  const userId = c.get('userId')
  const { page: rawPage } = await bodyOf(c)
  const page = Math.max(1, parseInt(rawPage || '1') || 1)
  const limit = 20
  const offset = (page - 1) * limit

  const notiSql = `
    SELECT n.id, n.type, n.post_id, n.content, n.read, n.created_at,
           p.title AS post_title, a.nickname AS actor_name
    FROM notifications n
    LEFT JOIN posts p ON p.id = n.post_id
    LEFT JOIN users a ON a.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT ? OFFSET ?`
  const countSql = 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?'

  const [{ results: notis }, countRow] = await Promise.all([
    c.env.DB.prepare(notiSql).bind(userId, limit, offset).all(),
    c.env.DB.prepare(countSql).bind(userId).first(),
  ])

  const list = (notis || []).map(r => ({
    notiType: r.type,
    notificationId: r.id,
    postId: r.post_id,
    postTitle: r.post_title || '(帖子已删除)',
    actorName: r.actor_name || '邻居',
    content: r.content || '',
    read: r.read === 1,
    createdAt: r.created_at,
  }))
  const total = countRow?.n ?? 0
  return success({ list, total, page, hasMore: offset + list.length < total })
})

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
