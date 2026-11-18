import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'

/** 能力查询不带登录凭据，旧后端的路由错误不能误清现有登录会话。 */
describe('public registration capability', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'existing-test-session')
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })
  it.each([401, 404])('treats legacy status %s as unsupported without invalidating the session', async status => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: status }), { status }))
    await expect(api.getRegistrationOptions()).resolves.toEqual({ inviteCodeSupported: false })
    expect(localStorage.getItem('token')).toBe('existing-test-session')
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
  })
  it('accepts only an explicit server capability flag', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { inviteCodeSupported: true } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { inviteCodeSupported: 'true' } })))
    await expect(api.getRegistrationOptions()).resolves.toEqual({ inviteCodeSupported: true })
    await expect(api.getRegistrationOptions()).resolves.toEqual({ inviteCodeSupported: false })
  })
  it('keeps a temporary server error distinct from lack of support', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 500 }), { status: 500 }))
    await expect(api.getRegistrationOptions()).rejects.toThrow('暂时无法确认邀请码是否可用')
    expect(localStorage.getItem('token')).toBe('existing-test-session')
  })
})
