// 帖子联系方式：可见性判断 + AES-256-GCM 字段级加密（Web Crypto）。
// 密文格式 enc:v1:<iv_b64url>:<ciphertext+tag_b64url>；无 CONTACT_ENC_KEY 时写明文；历史明文双读。

const PREFIX = 'enc:v1:'

/** 仅作者或已响应用户可见 contact */
export function canSeeContact(myId, authorId, myResponded) {
  if (!myId) return false
  return myId === authorId || !!myResponded
}

/** 从对象/列表行剔除 contact（公开列表、我的帖子列表） */
export function omitContact(row) {
  if (!row || typeof row !== 'object') return row
  const { contact, ...rest } = row
  return rest
}

/** 写入前加密；无 key / 空明文则原样（空串）返回 */
export async function encryptContact(plain, keyHex) {
  if (plain == null || plain === '') return ''
  const key = await importKey(keyHex)
  if (!key) return String(plain)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(plain)),
  )
  return `${PREFIX}${b64url(iv)}:${b64url(new Uint8Array(ct))}`
}

/** 是否为字段级密文 */
export function isEncryptedContact(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX)
}

/**
 * 授权后解密；非 enc 前缀视为历史明文。
 * 密文但无法解密时返回 null（勿当空串，避免编辑页静默清空后写回）。
 */
export async function decryptContact(stored, keyHex) {
  if (stored == null || stored === '') return ''
  const s = String(stored)
  if (!s.startsWith(PREFIX)) return s
  const rest = s.slice(PREFIX.length)
  const i = rest.indexOf(':')
  if (i < 0) return null
  const key = await importKey(keyHex)
  if (!key) return null
  try {
    const iv = fromB64url(rest.slice(0, i))
    const data = fromB64url(rest.slice(i + 1))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

async function importKey(keyHex) {
  if (!keyHex || typeof keyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(keyHex)) return null
  const raw = new Uint8Array(keyHex.match(/.{2}/g).map((h) => parseInt(h, 16)))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function b64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
