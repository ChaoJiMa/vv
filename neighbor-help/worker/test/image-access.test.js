import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from './support/database.js'
import { IMAGE_GRACE_MS, validateImageAttachments } from '../src/imageAccess.js'
import { signJWT } from '../src/auth.js'
import postRoutes from '../src/routes/posts.js'
import imageRoutes from '../src/routes/images.js'

describe('image attachment authorization', () => {
  let env, db, token
  beforeEach(async () => {
    db = createDatabase()
    db.sqlite.exec("INSERT INTO users (id, nickname) VALUES ('owner', 'Owner'), ('other', 'Other')")
    db.sqlite.exec("INSERT INTO posts (id, user_id, type, title, images) VALUES ('p1', 'owner', 'help', 'test', '[{\"key\":\"legacy.jpg\"}]')")
    env = { DB: db, JWT_SECRET: 'test-secret', IMAGES: {
      head: vi.fn(async () => ({ uploaded: new Date(), customMetadata: { ownerId: 'owner' } })),
      put: vi.fn(async () => {}), delete: vi.fn(async () => {}),
    } }
    token = await signJWT({ userId: 'owner', tv: 0 }, env.JWT_SECRET)
  })
  afterEach(() => db.sqlite.close())

  async function request(path, body) {
    return postRoutes.request(`http://localhost${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, env)
  }

  it('accepts a recent upload owned by this user', async () => {
    expect(await validateImageAttachments(env, 'owner', ['mine.jpg'])).toEqual({ ok: true })
  })

  it.each([null, { customMetadata: {} }, { customMetadata: { ownerId: 'other' } }])(
    'rejects missing, unowned and foreign uploads', async object => {
      env.IMAGES.head.mockResolvedValue(object)
      expect((await validateImageAttachments(env, 'owner', ['foreign.jpg'])).ok).toBe(false)
    }
  )

  it('rejects expired uploads while allowing an existing legacy attachment to remain', async () => {
    env.IMAGES.head.mockResolvedValue({ uploaded: new Date(Date.now() - IMAGE_GRACE_MS), customMetadata: { ownerId: 'owner' } })
    expect((await validateImageAttachments(env, 'owner', ['old.jpg'])).ok).toBe(false)
    expect(await validateImageAttachments(env, 'owner', ['legacy.jpg'], ['legacy.jpg'])).toEqual({ ok: true })
  })

  it('records the authenticated uploader in R2 metadata', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'image.jpg', { type: 'image/jpeg' }))
    const response = await imageRoutes.request('http://localhost/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    }, env)
    expect(response.status).toBe(200)
    expect(env.IMAGES.put.mock.calls[0][2].customMetadata.ownerId).toBe('owner')
  })

  it('rejects foreign keys when setting avatars, creating posts and editing posts', async () => {
    env.IMAGES.head.mockResolvedValue({ uploaded: new Date(), customMetadata: { ownerId: 'other' } })
    expect((await request('/me/update', { nickname: 'Owner', avatar: 'foreign.jpg' })).status).toBe(400)
    expect((await request('/posts/create', { type: 'help', title: 'test', images: ['foreign.jpg'] })).status).toBe(400)
    expect((await request('/posts/update', { id: 'p1', type: 'help', title: 'test', images: ['foreign.jpg'] })).status).toBe(400)
    expect(db.sqlite.prepare("SELECT avatar FROM users WHERE id='owner'").get().avatar).toBeNull()
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n).toBe(1)
    expect(db.sqlite.prepare("SELECT images FROM posts WHERE id='p1'").get().images).toContain('legacy.jpg')
  })

  it('allows owned uploads through avatar, create and edit routes', async () => {
    expect((await request('/me/update', { nickname: 'Owner', avatar: 'mine.jpg' })).status).toBe(200)
    const created = await request('/posts/create', { type: 'help', title: 'new post', images: [{ key: 'mine.jpg', width: 800, height: 600 }] })
    expect(created.status).toBe(200)
    const id = (await created.json()).data.id
    expect(JSON.parse(db.sqlite.prepare('SELECT images FROM posts WHERE id=?').get(id).images))
      .toEqual([{ key: 'mine.jpg', width: 800, height: 600 }])
    expect((await request('/posts/update', { id: 'p1', type: 'help', title: 'updated', images: ['mine.jpg'] })).status).toBe(200)
    expect(env.IMAGES.delete).toHaveBeenCalledExactlyOnceWith(['legacy.jpg'])
  })

  it('keeps existing legacy images editable without claiming another unowned key', async () => {
    env.IMAGES.head.mockResolvedValue({ customMetadata: {} })
    expect((await request('/posts/update', { id: 'p1', type: 'help', title: 'updated', images: ['legacy.jpg'] })).status).toBe(200)
    expect((await request('/posts/update', { id: 'p1', type: 'help', title: 'updated', images: ['unowned.jpg'] })).status).toBe(400)
  })

  it('does not immediately delete shared images on avatar changes, edits or post deletion', async () => {
    db.sqlite.exec("UPDATE users SET avatar='legacy.jpg' WHERE id='owner'")
    db.sqlite.exec("UPDATE users SET avatar='legacy.jpg' WHERE id='other'")
    expect((await request('/me/update', { nickname: 'Owner', avatar: null })).status).toBe(200)
    expect((await request('/posts/update', { id: 'p1', type: 'help', title: 'test', images: [] })).status).toBe(200)
    expect((await request('/posts/delete', { id: 'p1' })).status).toBe(200)
    expect(env.IMAGES.delete).not.toHaveBeenCalled()
    expect(db.sqlite.prepare("SELECT avatar FROM users WHERE id='other'").get().avatar).toBe('legacy.jpg')
  })
})
