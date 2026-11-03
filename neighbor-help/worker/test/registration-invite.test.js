import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import auth from '../src/routes/auth.js'
import posts from '../src/routes/posts.js'
import { CODE } from '../src/response.js'
import { verifyPassword } from '../src/auth.js'
import { createDatabase } from './support/database.js'

/** 所有注册与登录只调用内存 Hono/SQLite，不启动服务、不连接生产库或创建真实账号。 */
describe('可选注册邀请码', () => {
  let db, env
  const password = 'fictional-test-password'
  const account = { username: 'Neighbor001', password }

  async function request(path, body = {}, options = {}) {
    const response = await auth.request(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
    }, env)
    return { response, payload: await response.json() }
  }
  const register = extra => request('/register', { ...account, ...extra })
  const onlyUser = () => db.sqlite.prepare('SELECT * FROM users').get()
  const expectPrivateFieldsOmitted = user => {
    expect(Object.hasOwn(user, 'password')).toBe(false)
    expect(Object.hasOwn(user, 'registration_invite_code')).toBe(false)
  }

  beforeEach(() => {
    db = createDatabase()
    env = { DB: db, JWT_SECRET: 'registration-test-only-secret' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.sqlite.close()
  })

  it('公开能力声明无需鉴权或数据库', async () => {
    const response = await auth.request('/registration-options', { method: 'GET' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ code: CODE.OK, message: 'ok', data: { inviteCodeSupported: true } })
    expect(db.queries).toHaveLength(0)
  })

  it.each([undefined, null, '', '   '])('邀请码 %j 按空值注册，默认昵称不取登录用户名', async inviteCode => {
    const { response, payload } = await register({ inviteCode })
    expect(response.status).toBe(200)
    expect(payload.data.user.nickname).toBe('邻居')
    expect(payload.data.user.username).toBe('neighbor001')
    expect(onlyUser().registration_invite_code).toBeNull()
    expectPrivateFieldsOmitted(payload.data.user)
  })

  it.each([' aB12 ', '0000', 'a'.repeat(20)])('合法邀请码 %s 在注册 INSERT 中规范化保存', async inviteCode => {
    const { response, payload } = await register({ inviteCode, nickname: '  测试邻居  ' })
    expect(response.status).toBe(200)
    const stored = onlyUser()
    expect(stored.registration_invite_code).toBe(inviteCode.trim().toUpperCase())
    expect(stored.nickname).toBe('测试邻居')
    expect(stored.password).not.toBe(password)
    expect(await verifyPassword(password, stored.password)).toBe(true)
    expectPrivateFieldsOmitted(payload.data.user)
  })

  it.each(['ABC', 'a'.repeat(21), 'AB-12', 'AB 12', '邀请码一', 'ＡＢ１２', 1234, false, [], {}])('无效邀请码 %j 返回输入错误且不创建用户', async inviteCode => {
    const { response, payload } = await register({ inviteCode })
    expect(response.status).toBe(400)
    expect(payload.code).toBe(CODE.INVALID_INPUT)
    expect(payload.message).toBe('邀请码需为4-20位字母或数字')
    expect(db.sqlite.prepare('SELECT count(*) AS total FROM users').get().total).toBe(0)
  })

  it('邀请码不改变原用户名唯一约束，也不覆盖已保存的注册来源', async () => {
    await register({ inviteCode: 'AB12' })
    const { response, payload } = await register({ username: 'NEIGHBOR001', inviteCode: 'CD34' })
    expect(response.status).toBe(409)
    expect(payload.code).toBe(CODE.USERNAME_TAKEN)
    expect(db.sqlite.prepare('SELECT count(*) AS total FROM users').get().total).toBe(1)
    expect(onlyUser().registration_invite_code).toBe('AB12')
  })

  it('密码登录与本人信息都不回传密码或注册来源', async () => {
    await register({ inviteCode: 'AB12' })
    const { response, payload } = await request('/login', account)
    expect(response.status).toBe(200)
    expectPrivateFieldsOmitted(payload.data.user)
    const me = await posts.request('/me/get', { method: 'POST', headers: { Authorization: `Bearer ${payload.data.token}` } }, env)
    expect(me.status).toBe(200)
    expectPrivateFieldsOmitted((await me.json()).data)
  })

  it('微信登录旧账号时也剔除私有字段，且只调用模拟的微信服务', async () => {
    await register({ inviteCode: 'AB12' })
    db.sqlite.prepare('UPDATE users SET openid = ?').run('fictional-wechat-id')
    env.WX_APPID = 'test-only-app'
    env.WX_SECRET = 'test-only-secret'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ openid: 'fictional-wechat-id', access_token: 'test-only-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ nickname: '微信测试昵称' }))))
    const { response, payload } = await request('/wechat', { code: 'test-only-code' })
    expect(response.status).toBe(200)
    expectPrivateFieldsOmitted(payload.data.user)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('邀请码增量迁移', () => {
  it('在 0014 旧结构上增加可空列，并保留原有用户', () => {
    const sqlite = new DatabaseSync(':memory:')
    const migrationDirectory = new URL('../migrations/', import.meta.url)
    try {
      // 执行真实历史迁移构造升级前结构，防止只检查最新快照而遗漏 ALTER TABLE 问题。
      for (const file of readdirSync(migrationDirectory).filter(name => /^\d{4}_.*\.sql$/.test(name) && name < '0015_').sort()) {
        sqlite.exec(readFileSync(new URL(file, migrationDirectory), 'utf8'))
      }
      sqlite.prepare('INSERT INTO users (id, username, nickname) VALUES (?, ?, ?)').run('legacy-test-id', 'legacytest', '原有测试邻居')
      sqlite.exec(readFileSync(new URL('0015_registration_invite.sql', migrationDirectory), 'utf8'))
      const row = sqlite.prepare('SELECT id, nickname, registration_invite_code FROM users WHERE id = ?').get('legacy-test-id')
      expect({ ...row }).toEqual({ id: 'legacy-test-id', nickname: '原有测试邻居', registration_invite_code: null })
    } finally {
      sqlite.close()
    }
  })
})
