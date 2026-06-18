// 简单限流:基于 D1 记录 (key, 窗口起点, 计数)。用于登录/注册防暴力破解。
// key 通常取 `login:<ip>` 或 `login:<username>`。固定窗口算法,够用且无额外依赖。

// 表内混有不同窗口长度的 key(登录 10 分钟、发帖/私信 1 分钟等)。
// 顺手清理只能用一个不小于所有业务窗口的固定上限,否则短窗口调用会误删长窗口
// 仍在有效期内的记录(例如发帖请求把 1~10 分钟前的登录限流计数清空,防爆破失效)。
const STALE_MS = 60 * 60 * 1000 // 1 小时,安全覆盖所有业务窗口

// 检查并累加一次计数。超过 limit 返回 { limited: true, retryAfter }(秒);否则 { limited: false }。
export async function rateLimit(env, key, limit, windowMs) {
  const now = Date.now()
  // 清理远超任何业务窗口的陈旧记录,防止表无限膨胀(失败/未清零的记录会一直残留)。
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - STALE_MS).run()

  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(key).first()

  // 无记录或窗口已过期 -> 重置为新窗口
  if (!row || now - row.window_start >= windowMs) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ' +
      'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1'
    ).bind(key, now).run()
    return { limited: false }
  }

  // 窗口内已超限
  if (row.count >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - row.window_start)) / 1000)
    return { limited: true, retryAfter }
  }

  // 窗口内累加
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run()
  return { limited: false }
}

// 登录成功后清除计数,避免正常用户累积触发限流。
export async function resetRateLimit(env, key) {
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run()
}
