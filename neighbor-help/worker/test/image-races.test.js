import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { createDatabase } from './support/database.js'
import { signJWT } from '../src/auth.js'
import { reconcileImages } from '../src/reconcile.js'
import postRoutes from '../src/routes/posts.js'
import imageRoutes from '../src/routes/images.js'

describe('image cleanup race regressions', () => {
  let db, env, token, stored
  beforeEach(async () => {
    db = createDatabase()
    db.sqlite.exec("INSERT INTO users (id, nickname) VALUES ('owner', 'Owner')")
    db.sqlite.exec("INSERT INTO posts (id, user_id, type, title, images) VALUES ('p1', 'owner', 'help', 'test', '[{\"key\":\"old.jpg\"}]')")
    stored = new Map([['old.jpg', { key: 'old.jpg', uploaded: new Date(Date.now() - 2 * 24 * 3600_000), customMetadata: { ownerId: 'owner' }, httpMetadata: { contentType: 'image/jpeg' }, body: new Uint8Array([0xff, 0xd8, 0xff]) }]])
    env = { DB: db, JWT_SECRET: 'test-secret', IMAGES: {
      head: async key => stored.get(key) || null,
      get: async key => stored.get(key) || null,
      list: async () => ({ objects: [...stored.values()], truncated: false }),
      delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) stored.delete(key) },
    } }
    token = await signJWT({ userId: 'owner', tv: 0 }, env.JWT_SECRET)
  })
  afterEach(() => db.sqlite.close())
  function request(path, body) {
    return postRoutes.request(`http://localhost${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, env)
  }

  it('rejects a delayed retained-image edit while a claimed object is being deleted', async () => {
    let releaseEdit, signalEdit
    const gate = new Promise(resolve => { releaseEdit = resolve })
    const editWaiting = new Promise(resolve => { signalEdit = resolve })
    const prepare = db.prepare.bind(db)
    db.prepare = sql => {
      const statement = prepare(sql)
      if (sql.startsWith('UPDATE posts SET type=')) {
        const run = statement.run.bind(statement)
        statement.run = async () => { signalEdit(); await gate; return run() }
      }
      return statement
    }
    // 请求 A 已读取原帖引用并通过 retained-key 校验，等待写入。
    const edit = request('/posts/update', { id: 'p1', type: 'help', title: 'retained edit', images: ['old.jpg'] })
    await editWaiting
    // 请求 B 移除图片，使它进入孤儿候选集。
    db.sqlite.exec("UPDATE posts SET images='[]' WHERE id='p1'")
    const remove = env.IMAGES.delete
    env.IMAGES.delete = async keys => {
      // 删除前的最终查库已结束，此时请求 A 恢复图片引用。
      releaseEdit()
      expect((await edit).status).toBe(409)
      await remove(keys)
    }
    expect(await reconcileImages(env)).toEqual({ scanned: 1, deleted: 1 })
    expect(db.sqlite.prepare("SELECT images FROM posts WHERE id='p1'").get().images).toBe('[]')
    expect(stored.has('old.jpg')).toBe(false)
  })

  it('stops serving an unshared image as soon as its post is deleted', async () => {
    expect((await request('/posts/delete', { id: 'p1' })).status).toBe(200)
    expect((await imageRoutes.request('http://localhost/img/old.jpg', {}, env)).status).toBe(404)
    await reconcileImages(env)
    expect((await imageRoutes.request('http://localhost/img/old.jpg', {}, env)).status).toBe(404)
  })
})
