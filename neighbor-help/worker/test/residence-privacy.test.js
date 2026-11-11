import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './support/database.js'
import { signJWT } from '../src/auth.js'
import posts from '../src/routes/posts.js'
import messages from '../src/routes/messages.js'

/** 使用真实 SQLite、JWT 与路由 SQL 验证房号权限，覆盖新旧 DTO、私信及帖子地点的默认来源。 */
describe('residence privacy across post and conversation routes', () => {
  const secret = 'residence-test-secret'
  let db

  beforeEach(() => {
    db = createDatabase()
    db.sqlite.exec(`
      INSERT INTO users (id, nickname, building, unit) VALUES ('owner', '帖主', '3', '701');
      INSERT INTO users (id, nickname, building, unit) VALUES ('neighbor', '邻居', '5', '802');
      INSERT INTO posts (id, user_id, type, title, content, images, location, created_at)
        VALUES ('post-1', 'owner', 'help', '借梯子', '周末借用', '[]', '3栋楼下', 1000);
      INSERT INTO conversations (id, user_a, user_b, post_id, post_title, created_at)
        VALUES ('conv-1', 'neighbor', 'owner', 'post-1', '借梯子', 1000);
    `)
  })

  afterEach(() => db.sqlite.close())

  async function request(app, path, body = {}, userId) {
    const headers = { 'Content-Type': 'application/json' }
    if (userId) headers.Authorization = `Bearer ${await signJWT({ userId, tv: 0 }, secret)}`
    const response = await app.request(`http://localhost${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    }, { DB: db, JWT_SECRET: secret })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.code).toBe(200)
    return payload.data
  }

  it.each([undefined, 'neighbor'])('redacts author rooms for the %s viewer in both post representations', async (viewer) => {
    // 即使请求体冒充作者，房号权限仍只认已验签的会话身份。
    const body = { id: 'post-1', viewerId: 'owner' }
    const list = await request(posts, '/posts/list', body, viewer)
    const detail = await request(posts, '/posts/detail', body, viewer)
    for (const post of [list.list[0], detail]) {
      expect(post.author).toMatchObject({ building: '3', unit: '' })
      expect(post.building).toBe('3')
      expect(post.unit).toBe('')
      expect(JSON.stringify(post)).not.toContain('701')
    }
  })

  it('keeps the owner profile and author edit data available only to that owner', async () => {
    const detail = await request(posts, '/posts/detail', { id: 'post-1' }, 'owner')
    const mine = await request(posts, '/me/posts', {}, 'owner')
    const ownList = await request(posts, '/posts/list', {}, 'owner')
    for (const post of [detail, mine.list[0], ownList.list[0]]) {
      expect(post.author.unit).toBe('701')
      expect(post.unit).toBe('701')
      expect(post.location).toBe('3栋楼下')
    }
    expect(await request(posts, '/me/get', {}, 'owner')).toMatchObject({ id: 'owner', unit: '701' })
    expect(await request(posts, '/me/get', { id: 'owner' }, 'neighbor')).toMatchObject({ id: 'neighbor', unit: '802' })
  })

  it.each(['owner', 'neighbor'])('omits the other participant room from %s conversation metadata', async (viewer) => {
    const data = await request(messages, '/messages/thread', { conversationId: 'conv-1' }, viewer)
    expect(data.peer.id).toBe(viewer === 'owner' ? 'neighbor' : 'owner')
    expect(data.peer.building).toBe(viewer === 'owner' ? '5' : '3')
    expect(data.peer.unit).toBe('')
    expect(JSON.stringify(data.peer)).not.toContain(viewer === 'owner' ? '802' : '701')
  })

  it.each([undefined, '', '   '])('defaults a new post with location %j to the building only', async (location) => {
    const data = await request(posts, '/posts/create', { type: 'help', title: '借梯子', location }, 'owner')
    expect(db.sqlite.prepare('SELECT location FROM posts WHERE id=?').get(data.id).location).toBe('3栋')
  })

  it('leaves the default location empty when only a profile room is available', async () => {
    db.sqlite.exec("UPDATE users SET building='' WHERE id='owner'")
    const data = await request(posts, '/posts/create', { type: 'help', title: '借梯子' }, 'owner')
    expect(db.sqlite.prepare('SELECT location FROM posts WHERE id=?').get(data.id).location).toBe('')
  })

  it('preserves an explicitly published location when creating, reading and editing a post', async () => {
    const location = '3栋701号（手动填写）'
    const created = await request(posts, '/posts/create', { type: 'help', title: '借梯子', location }, 'owner')
    const publicPost = await request(posts, '/posts/detail', { id: created.id })
    expect(publicPost.location).toBe(location)
    expect(publicPost.author.unit).toBe('')
    const editing = await request(posts, '/posts/detail', { id: created.id }, 'owner')
    await request(posts, '/posts/update', {
      id: created.id, type: 'help', title: '更新借用时间', content: '', images: [], contact: '', location: editing.location,
    }, 'owner')
    expect(db.sqlite.prepare('SELECT location FROM posts WHERE id=?').get(created.id).location).toBe(location)
  })
})
