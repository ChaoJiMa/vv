import { verifyAuth } from './auth.js'

export async function handlePosts(request, env, headers, pathname) {
  const method = request.method
  const parts = pathname.split('/').filter(Boolean) // ['api', 'posts', ':id', ...]

  // GET /api/me
  if (pathname === '/api/me' && method === 'GET') {
    const auth = await verifyAuth(request, env)
    if (!auth) return unauth(headers)
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.userId).first()
    return ok(user, headers)
  }

  // PUT /api/me
  if (pathname === '/api/me' && method === 'PUT') {
    const auth = await verifyAuth(request, env)
    if (!auth) return unauth(headers)
    const { building, unit, nickname } = await request.json()
    await env.DB.prepare('UPDATE users SET building=?, unit=?, nickname=? WHERE id=?')
      .bind(building, unit, nickname, auth.userId).run()
    return ok({ success: true }, headers)
  }

  // GET /api/posts
  if (pathname === '/api/posts' && method === 'GET') {
    const url = new URL(request.url)
    const type = url.searchParams.get('type')
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = 20
    const offset = (page - 1) * limit

    const query = type
      ? 'SELECT p.*, u.nickname, u.building, u.unit FROM posts p JOIN users u ON p.user_id=u.id WHERE p.type=? ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
      : 'SELECT p.*, u.nickname, u.building, u.unit FROM posts p JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?'

    const { results } = type
      ? await env.DB.prepare(query).bind(type, limit, offset).all()
      : await env.DB.prepare(query).bind(limit, offset).all()

    return ok(results, headers)
  }

  // POST /api/posts
  if (pathname === '/api/posts' && method === 'POST') {
    const auth = await verifyAuth(request, env)
    if (!auth) return unauth(headers)
    const { type, title, content, images } = await request.json()
    if (!type || !title) return new Response(JSON.stringify({ error: '缺少必要字段' }), { status: 400, headers })
    const { meta } = await env.DB.prepare(
      'INSERT INTO posts (user_id, type, title, content, images) VALUES (?, ?, ?, ?, ?)'
    ).bind(auth.userId, type, title, content || '', JSON.stringify(images || [])).run()
    return ok({ id: meta.last_row_id }, headers)
  }

  // GET /api/posts/:id
  if (parts[1] === 'posts' && parts[2] && method === 'GET') {
    const id = parts[2]
    const post = await env.DB.prepare(
      'SELECT p.*, u.nickname, u.building, u.unit FROM posts p JOIN users u ON p.user_id=u.id WHERE p.id=?'
    ).bind(id).first()
    if (!post) return new Response(JSON.stringify({ error: '帖子不存在' }), { status: 404, headers })
    const { results: comments } = await env.DB.prepare(
      'SELECT c.*, u.nickname, u.building FROM comments c JOIN users u ON c.user_id=u.id WHERE c.post_id=? ORDER BY c.created_at ASC'
    ).bind(id).all()
    return ok({ ...post, comments }, headers)
  }

  // POST /api/posts/:id/comments
  if (parts[1] === 'posts' && parts[3] === 'comments' && method === 'POST') {
    const auth = await verifyAuth(request, env)
    if (!auth) return unauth(headers)
    const { content } = await request.json()
    await env.DB.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
      .bind(parts[2], auth.userId, content).run()
    return ok({ success: true }, headers)
  }

  // PUT /api/posts/:id/close
  if (parts[1] === 'posts' && parts[3] === 'close' && method === 'PUT') {
    const auth = await verifyAuth(request, env)
    if (!auth) return unauth(headers)
    await env.DB.prepare('UPDATE posts SET status="closed" WHERE id=? AND user_id=?')
      .bind(parts[2], auth.userId).run()
    return ok({ success: true }, headers)
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers })
}

const ok = (data, headers) => new Response(JSON.stringify(data), { headers })
const unauth = (headers) => new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers })
