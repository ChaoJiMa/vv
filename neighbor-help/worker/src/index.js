import { handleAuth } from './auth.js'
import { handlePosts } from './posts.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname } = url

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Content-Type': 'application/json',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    try {
      if (pathname.startsWith('/auth')) {
        return handleAuth(request, env, headers)
      }
      if (pathname.startsWith('/api')) {
        return handlePosts(request, env, headers, pathname)
      }
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers })
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers })
    }
  }
}
