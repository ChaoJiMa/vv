import { describe, it, expect } from 'vitest'
import { describeRoute, redact, readBodyForLog, peekUserId } from '../src/logger.js'

describe('describeRoute', () => {
  it('匹配静态 POST 路由', () => {
    expect(describeRoute('POST', '/auth/login')).toBe('用户登录')
    expect(describeRoute('POST', '/api/menus/list')).toBe('获取服务类型菜单')
    expect(describeRoute('POST', '/api/me/password')).toBe('修改密码')
    expect(describeRoute('POST', '/api/posts/detail')).toBe('获取帖子详情')
    expect(describeRoute('POST', '/api/posts/comment')).toBe('发表评论')
    expect(describeRoute('POST', '/api/posts/close')).toBe('标记帖子完成')
  })

  it('方法不匹配 / 未知路由返回未知接口', () => {
    expect(describeRoute('GET', '/api/posts/list')).toBe('未知接口')
    expect(describeRoute('POST', '/nope')).toBe('未知接口')
  })
})

describe('redact 脱敏', () => {
  it('脱敏密码/token 字段', () => {
    const out = redact({ username: 'bob', password: 'secret', token: 'abc' })
    expect(out).toEqual({ username: 'bob', password: '***', token: '***' })
  })

  it('递归脱敏嵌套对象', () => {
    const out = redact({ user: { nickname: 'x', oldPassword: 'p', newPassword: 'q' } })
    expect(out.user).toEqual({ nickname: 'x', oldPassword: '***', newPassword: '***' })
  })

  it('非对象原样返回', () => {
    expect(redact('hi')).toBe('hi')
    expect(redact(null)).toBe(null)
  })
})

describe('readBodyForLog', () => {
  it('GET 请求不读 body', async () => {
    const req = new Request('https://x/api/posts', { method: 'GET' })
    expect(await readBodyForLog(req)).toBeUndefined()
  })

  it('POST 请求读取并脱敏 body,且不消费原始请求', async () => {
    const req = new Request('https://x/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', password: 'secret' }),
    })
    const logged = await readBodyForLog(req)
    expect(logged).toEqual({ username: 'bob', password: '***' })
    // 原始请求仍可被下游消费
    const downstream = await req.json()
    expect(downstream.password).toBe('secret')
  })

  it('非法 JSON 返回占位符', async () => {
    const req = new Request('https://x/api/posts', { method: 'POST', body: 'not-json' })
    expect(await readBodyForLog(req)).toBe('<unparseable>')
  })
})

describe('peekUserId', () => {
  // 构造 URL-safe base64 的 payload(与 auth.signJWT 同口径)
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  it('从 Bearer token 取出 userId', () => {
    const token = `h.${b64url({ userId: 'abc-uuid', exp: 1 })}.sig`
    const req = new Request('https://x/api/me', { headers: { Authorization: `Bearer ${token}` } })
    expect(peekUserId(req)).toBe('abc-uuid')
  })

  it('无 Authorization 头返回 undefined', () => {
    const req = new Request('https://x/api/posts')
    expect(peekUserId(req)).toBeUndefined()
  })

  it('畸形 token 返回 undefined 不抛错', () => {
    const req = new Request('https://x/api/me', { headers: { Authorization: 'Bearer garbage' } })
    expect(peekUserId(req)).toBeUndefined()
  })
})
