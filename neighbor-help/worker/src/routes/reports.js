// /api 举报路由。需登录。
// 本期无管理后台,举报先沉淀到 reports 表,待人工复核(status=pending)。
// 同一用户对同一目标只记一次(UNIQUE 冲突视为已举报),并加限流防刷。
import { Hono } from 'hono'
import { genId } from '../auth.js'
import { success, fail, CODE } from '../response.js'
import { LIMITS, optionalText } from '../validate.js'
import { authRequired } from '../middleware.js'
import { rateLimit } from '../ratelimit.js'

const bodyOf = async (c) => { try { return await c.req.json() } catch { return {} } }

// 举报限流:同一用户 1 分钟最多 10 次(防恶意刷举报)
const REPORT_RL_LIMIT = 10
const REPORT_RL_WINDOW_MS = 60 * 1000

const reports = new Hono()
reports.use('*', authRequired)

// POST /api/reports/create —— 举报帖子或评论,参数 { targetType, targetId, reason? }
reports.post('/reports/create', async (c) => {
  const userId = c.get('userId')
  const rl = await rateLimit(c.env, `report:${userId}`, REPORT_RL_LIMIT, REPORT_RL_WINDOW_MS)
  if (rl.limited) return fail(CODE.TOO_MANY_REQUESTS, `操作过于频繁,请${rl.retryAfter}秒后再试`)

  const { targetType, targetId, reason } = await bodyOf(c)
  if ((targetType !== 'post' && targetType !== 'comment') || !targetId) {
    return fail(CODE.REPORT_BAD_TARGET, '举报对象无效')
  }
  const rs = optionalText(reason, LIMITS.reportReason, '举报理由')
  if (!rs.ok) return fail(CODE.REPORT_BAD_TARGET, rs.message)

  // 校验目标存在,避免对不存在的 id 留下孤儿举报
  const table = targetType === 'post' ? 'posts' : 'comments'
  const target = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(targetId).first()
  if (!target) return fail(CODE.REPORT_BAD_TARGET, '举报对象不存在')

  // UNIQUE(reporter_id, target_type, target_id) 保证同一人对同一目标只记一次。
  // 以真正插入(meta.changes)区分首次举报与重复举报,给用户明确反馈。
  const { meta } = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(genId(), userId, targetType, targetId, rs.value || null, 'pending', Date.now()).run()
  if (!meta.changes) return fail(CODE.REPORT_DUPLICATE, '你已举报过,我们会尽快核实')
  return success({ success: true })
})

export default reports
