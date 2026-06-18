import { describe, it, expect } from 'vitest'
import { success, fail, CODE } from '../src/response.js'
import { hashPassword, verifyPassword, signJWT, verifyJWT, timingSafeEqual, genId } from '../src/auth.js'

const HEADERS = { 'Content-Type': 'application/json' }
const SECRET = 'test-secret'

describe('response 封装', () => {
  it('success 返回 code 200 与 data', async () => {
    const res = success({ a: 1 }, HEADERS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ code: 200, message: 'ok', data: { a: 1 } })
  })

  it('fail 按业务码映射 HTTP 状态', async () => {
    const res = fail(CODE.USERNAME_TAKEN, '用户名已被注册', HEADERS)
    expect(res.status).toBe(409) // USERNAME_TAKEN -> 409
    const body = await res.json()
    expect(body.code).toBe(CODE.USERNAME_TAKEN)
    expect(body.message).toBe('用户名已被注册')
    expect(body.data).toBeNull()
  })

  it('未知业务码默认 400', async () => {
    const res = fail(99999, 'x', HEADERS)
    expect(res.status).toBe(400)
  })
})

describe('密码哈希', () => {
  it('正确密码可通过校验', async () => {
    const stored = await hashPassword('hunter2')
    expect(stored).toContain(':')
    expect(await verifyPassword('hunter2', stored)).toBe(true)
  })

  it('错误密码不通过', async () => {
    const stored = await hashPassword('hunter2')
    expect(await verifyPassword('wrong', stored)).toBe(false)
  })

  it('相同密码两次哈希不同(随机盐)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })

  it('畸形存储值返回 false 而非抛错', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false)
  })
})

describe('JWT 签验', () => {
  it('签发的 token 能被验证并取回 payload', async () => {
    const token = await signJWT({ userId: 42 }, SECRET)
    const payload = await verifyJWT(token, SECRET)
    expect(payload.userId).toBe(42)
    expect(payload.exp).toBeGreaterThan(Date.now())
  })

  it('payload 含 iat / jti / exp(毫秒)', async () => {
    const token = await signJWT({ userId: 1 }, SECRET)
    const payload = await verifyJWT(token, SECRET)
    expect(payload.iat).toBeLessThanOrEqual(Date.now())
    expect(typeof payload.jti).toBe('string')
    expect(payload.jti.length).toBeGreaterThan(0)
    expect(payload.exp - payload.iat).toBe(30 * 24 * 3600 * 1000)
  })

  it('payload 含中文等非 ASCII 字符可正确签验(URL-safe base64 + UTF-8)', async () => {
    const token = await signJWT({ userId: 7, nickname: '邻居小明😀' }, SECRET)
    const payload = await verifyJWT(token, SECRET)
    expect(payload.nickname).toBe('邻居小明😀')
  })

  it('错误密钥验证失败', async () => {
    const token = await signJWT({ userId: 1 }, SECRET)
    expect(await verifyJWT(token, 'wrong-secret')).toBeNull()
  })

  it('畸形 token 返回 null 不抛错', async () => {
    expect(await verifyJWT('garbage', SECRET)).toBeNull()
    expect(await verifyJWT('a.b.c', SECRET)).toBeNull()
    expect(await verifyJWT('', SECRET)).toBeNull()
  })

  it('篡改 payload 导致签名不匹配,验证失败', async () => {
    const token = await signJWT({ userId: 1 }, SECRET)
    expect(await verifyJWT(token, SECRET)).not.toBeNull()
    // 替换 header/body 但保留原签名 -> 签名校验失败
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = btoa(JSON.stringify({ userId: 999, exp: Date.now() + 1000 }))
    const tampered = `${header}.${body}.${token.split('.')[2]}`
    expect(await verifyJWT(tampered, SECRET)).toBeNull()
  })
})

describe('genId', () => {
  it('生成 32 位 hex,不含横杠', () => {
    const id = genId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(id).not.toContain('-')
  })
  it('两次生成不同', () => {
    expect(genId()).not.toBe(genId())
  })
})

describe('timingSafeEqual', () => {
  it('相等返回 true', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
  })
  it('不等返回 false', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
  })
  it('长度不同返回 false', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})
