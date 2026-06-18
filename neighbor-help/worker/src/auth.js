// 认证工具集:密码哈希、JWT 签验、verifyAuth、genId。
// 路由处理已迁移到 routes/auth.js(Hono);这里只保留可复用的 crypto / 校验工具。

export async function verifyAuth(request, env) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload) return null
  // 比对 token_version:改密码/退出登录会令 DB 中版本 +1,旧 token 携带的旧版本即失效(可吊销)
  const user = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?').bind(payload.userId).first()
  if (!user) return null
  if ((payload.tv ?? 0) !== (user.token_version ?? 0)) return null
  return payload
}

// ===== 主键 ID(去横杠的 32 位 hex,不暴露递增规律) =====
export function genId() {
  return crypto.randomUUID().replace(/-/g, '')
}

// token_version+1 并返回新版本号:用于吊销旧 token(改密码、退出登录)
export async function bumpTokenVersion(env, userId) {
  await env.DB.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').bind(userId).run()
  const row = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?').bind(userId).first()
  return row?.token_version ?? 0
}

// ===== 密码哈希(Web Crypto PBKDF2,不依赖 Node 库) =====
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await deriveBits(password, salt)
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = fromHex(saltHex)
  const bits = await deriveBits(password, salt)
  return toHex(new Uint8Array(bits)) === hashHex
}

async function deriveBits(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  )
}

function toHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)))
}

// ===== JWT(HMAC-SHA256) =====
// 说明:exp/iat 沿用毫秒时间戳(与项目 Date.now() 口径一致,前端无需 *1000);
// header/payload 用 URL-safe base64,避免含中文/特殊字符时 atob/btoa 出错。
const TOKEN_TTL = 30 * 24 * 3600 * 1000 // 30 天(毫秒)

export async function signJWT(payload, secret) {
  const now = Date.now()
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64urlEncode(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + TOKEN_TTL,
    jti: genId(),
  }))
  const sig = await hmacSign(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

export async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.')
    if (!header || !body || !sig) return null
    const expected = await hmacSign(`${header}.${body}`, secret)
    if (!timingSafeEqual(sig, expected)) return null
    const payload = JSON.parse(b64urlDecode(body))
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    // 畸形 token(非法 base64/JSON 等)一律视为未授权,不向上抛异常
    return null
  }
}

// URL-safe base64(无填充)编解码,支持 UTF-8(中文昵称等)
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// 导出:供 logger 复用,统一 JWT payload 的 UTF-8 解码口径(替代废弃的 escape/unescape)。
export function b64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// 恒定时间字符串比较:无论是否相等都遍历全长,避免泄露签名匹配进度的时序侧信道
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
