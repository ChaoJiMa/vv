import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './support/database.js'
import routes from '../src/routes/posts.js'

describe('batched comment previews', () => {
  let db
  beforeEach(() => {
    db = createDatabase()
    db.sqlite.exec("INSERT INTO users (id, nickname) VALUES ('u1', 'Owner')")
    db.sqlite.exec("INSERT INTO posts (id, user_id, type, title) VALUES ('p1', 'u1', 'help', 'test')")
    for (let i = 0; i < 21; i++) {
      db.sqlite.prepare('INSERT INTO comments (id, post_id, user_id, content, created_at, pinned_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`c${String(i).padStart(2, '0')}`, 'p1', 'u1', `comment${i}`, i, i === 20 ? 100 : null)
    }
    for (let i = 0; i < 3; i++) {
      db.sqlite.prepare('INSERT INTO comment_replies (id, comment_id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`r${i}`, 'c00', 'p1', 'u1', `reply${i}`, i)
    }
    db.sqlite.exec("INSERT INTO comment_replies (id, comment_id, post_id, user_id, content, created_at) VALUES ('last', 'c19', 'p1', 'u1', 'last page', 1)")
  })
  afterEach(() => db.sqlite.close())

  async function page(number) {
    const response = await routes.request('http://localhost/posts/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'p1', page: number }),
    }, { DB: db })
    expect(response.status).toBe(200)
    return (await response.json()).data
  }

  it('uses 3 SQL queries for 20 comments and preserves pin order, previews and totals', async () => {
    const data = await page(1)
    expect(db.queries).toHaveLength(3)
    expect(data.total).toBe(21)
    expect(data.hasMore).toBe(true)
    expect(data.list).toHaveLength(20)
    expect(data.list[0].id).toBe('c20')
    expect(data.list[0].pinned).toBe(true)
    expect(data.list[0].replies).toEqual({ list: [], total: 0, page: 1, hasMore: false })
    const replies = data.list.find(row => row.id === 'c00').replies
    expect(replies.list.map(row => row.id)).toEqual(['r0', 'r1'])
    expect(replies.total).toBe(3)
    expect(replies.hasMore).toBe(true)
  })

  it('keeps replies isolated to the requested page and handles empty pages', async () => {
    const data = await page(2)
    expect(data.hasMore).toBe(false)
    expect(data.list.map(row => row.id)).toEqual(['c19'])
    expect(data.list[0].replies.list.map(row => row.id)).toEqual(['last'])
    db.queries.length = 0
    expect((await page(3)).list).toEqual([])
    expect(db.queries).toHaveLength(2)
  })
})
