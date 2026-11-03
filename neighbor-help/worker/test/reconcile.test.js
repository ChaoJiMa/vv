import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from './support/database.js'
import { reconcileImages } from '../src/reconcile.js'
import { IMAGE_GRACE_MS } from '../src/imageAccess.js'

describe('image reconciliation', () => {
  let db, env, objects
  beforeEach(() => {
    db = createDatabase()
    db.sqlite.exec("INSERT INTO users (id) VALUES ('owner')")
    objects = []
    env = { DB: db, IMAGES: {
      list: vi.fn(async () => ({ objects, truncated: false })),
      delete: vi.fn(async () => {}),
    } }
  })
  afterEach(() => db.sqlite.close())

  function image(key, age = IMAGE_GRACE_MS + 1000) {
    objects.push({ key, uploaded: new Date(Date.now() - age) })
  }
  function post(id, images) {
    db.sqlite.prepare('INSERT INTO posts (id, user_id, type, title, images) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'owner', 'help', 'test', images)
  }

  it('protects legacy keys, object images and avatars; deletes only old orphans', async () => {
    post('p1', JSON.stringify(['legacy.jpg', { key: 'current.webp', width: 800, height: 600 }]))
    db.sqlite.exec("UPDATE users SET avatar = 'avatar.png' WHERE id = 'owner'")
    for (const key of ['legacy.jpg', 'current.webp', 'avatar.png', 'orphan.jpg']) image(key)
    image('recent.jpg', 1000)
    expect(await reconcileImages(env)).toEqual({ scanned: 5, deleted: 1 })
    expect(env.IMAGES.delete).toHaveBeenCalledExactlyOnceWith(['orphan.jpg'])
  })

  it.each(['{broken', '{}', '[null]', '[{"key":"../bad.jpg"}]'])(
    'aborts without deleting when stored references are corrupt: %s', async raw => {
      post('p1', raw)
      image('unknown.jpg')
      await expect(reconcileImages(env)).rejects.toThrow()
      expect(env.IMAGES.delete).not.toHaveBeenCalled()
    }
  )

  it('protects new references written after the initial database scan', async () => {
    image('post.jpg')
    image('avatar.jpg')
    env.IMAGES.list.mockImplementation(async () => {
      post('late', '[{"key":"post.jpg"}]')
      db.sqlite.exec("UPDATE users SET avatar = 'avatar.jpg' WHERE id = 'owner'")
      return { objects, truncated: false }
    })
    expect(await reconcileImages(env)).toEqual({ scanned: 2, deleted: 0 })
    expect(env.IMAGES.delete).not.toHaveBeenCalled()
  })

  it('scans multiple database and R2 pages and limits deletion batches to 100', async () => {
    for (let i = 0; i < 501; i++) {
      const key = `used${i}.jpg`
      post(`p${String(i).padStart(4, '0')}`, JSON.stringify([{ key }]))
      db.sqlite.prepare('INSERT INTO users (id, avatar) VALUES (?, ?)').run(`u${i}`, `avatar${i}.jpg`)
    }
    image('used500.jpg')
    image('avatar500.jpg')
    for (let i = 0; i < 205; i++) image(`orphan${i}.jpg`)
    env.IMAGES.list.mockImplementation(async ({ cursor }) => cursor
      ? { objects: objects.slice(120), truncated: false }
      : { objects: objects.slice(0, 120), truncated: true, cursor: 'page2' })
    expect(await reconcileImages(env)).toEqual({ scanned: 207, deleted: 205 })
    expect(env.IMAGES.delete.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 5])
    expect(env.IMAGES.list).toHaveBeenLastCalledWith({ cursor: 'page2', limit: 1000 })
  })

  it('never deletes when the reference database fails', async () => {
    env.DB = { prepare: () => { throw new Error('database unavailable') } }
    await expect(reconcileImages(env)).rejects.toThrow('database unavailable')
    expect(env.IMAGES.delete).not.toHaveBeenCalled()
  })
})
