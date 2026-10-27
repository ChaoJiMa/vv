// 首页滚动公告(表) + 安全提示(app_config);管理员 CRUD
import { Hono } from 'hono'
import { genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { authRequired } from '../middleware.js'
import { LIMITS, requireText } from '../validate.js'
import { ANNOUNCEMENTS_FALLBACK, getSafetyTips } from '../config.js'

const bodyOf = async (c) => { try { return await c.req.json() } catch { return {} } }

async function requireAdmin(c) {
  const userId = c.get('userId')
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first()
  if (!row || row.role !== 'admin') return fail(CODE.FORBIDDEN, '需要管理员权限')
  return null
}

function parseSort(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: 0 }
  const n = Number(raw)
  if (!Number.isInteger(n)) return { ok: false, message: '排序须为整数' }
  return { ok: true, value: n }
}

const announcements = new Hono()

// POST /api/announcements/list —— 公开:{ notices, safetyTips }
announcements.post('/announcements/list', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT content FROM announcements
     WHERE enabled = 1
     ORDER BY sort DESC, updated_at DESC`
  ).all()
  const rows = results ?? []
  const notices = rows.length
    ? rows.map((r) => r.content).filter(Boolean)
    : ANNOUNCEMENTS_FALLBACK.notices
  const safetyTips = await getSafetyTips(c.env)
  return success({ notices, safetyTips })
})

announcements.post('/announcements/admin/list', authRequired, async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const { results } = await c.env.DB.prepare(
    `SELECT id, content, sort, enabled, created_at, updated_at FROM announcements
     ORDER BY sort DESC, updated_at DESC`
  ).all()
  return success({ list: results ?? [] })
})

announcements.post('/announcements/admin/create', authRequired, async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const { content, sort: rawSort } = await bodyOf(c)
  const ct = requireText(content, LIMITS.announcement, '公告内容')
  if (!ct.ok) return fail(CODE.BAD_REQUEST, ct.message)
  const s = parseSort(rawSort)
  if (!s.ok) return fail(CODE.BAD_REQUEST, s.message)
  const id = genId()
  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO announcements (id, content, sort, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).bind(id, ct.value, s.value, now, now).run()
  return success({ id, content: ct.value, sort: s.value, enabled: 1 })
})

announcements.post('/announcements/admin/update', authRequired, async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const { id, content, sort: rawSort, enabled } = await bodyOf(c)
  if (!id || typeof id !== 'string') return fail(CODE.BAD_REQUEST, '缺少公告 id')
  const existing = await c.env.DB.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first()
  if (!existing) return fail(CODE.NOT_FOUND, '公告不存在')

  const sets = []
  const args = []
  if (content !== undefined) {
    const ct = requireText(content, LIMITS.announcement, '公告内容')
    if (!ct.ok) return fail(CODE.BAD_REQUEST, ct.message)
    sets.push('content = ?'); args.push(ct.value)
  }
  if (rawSort !== undefined) {
    const s = parseSort(rawSort)
    if (!s.ok) return fail(CODE.BAD_REQUEST, s.message)
    sets.push('sort = ?'); args.push(s.value)
  }
  if (enabled !== undefined) {
    if (enabled !== 0 && enabled !== 1) return fail(CODE.BAD_REQUEST, 'enabled 只能为 0 或 1')
    sets.push('enabled = ?'); args.push(enabled)
  }
  if (!sets.length) return fail(CODE.BAD_REQUEST, '没有可更新的字段')
  sets.push('updated_at = ?'); args.push(Date.now())
  args.push(id)
  await c.env.DB.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run()
  return success({ success: true })
})

announcements.post('/announcements/admin/delete', authRequired, async (c) => {
  const denied = await requireAdmin(c)
  if (denied) return denied
  const { id } = await bodyOf(c)
  if (!id || typeof id !== 'string') return fail(CODE.BAD_REQUEST, '缺少公告 id')
  const existing = await c.env.DB.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first()
  if (!existing) return fail(CODE.NOT_FOUND, '公告不存在')
  await c.env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run()
  return success({ success: true })
})

export default announcements
