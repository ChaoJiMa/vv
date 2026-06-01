// 微信 OAuth + JWT 签发
export async function handleAuth(request, env, headers) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400, headers })
  }

  // 用 code 换 openid
  const wxRes = await fetch(
    `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${env.WX_APPID}&secret=${env.WX_SECRET}&code=${code}&grant_type=authorization_code`
  )
  const wxData = await wxRes.json()

  if (wxData.errcode) {
    return new Response(JSON.stringify({ error: wxData.errmsg }), { status: 401, headers })
  }

  const { openid, access_token } = wxData

  // 获取用户信息
  const infoRes = await fetch(
    `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`
  )
  const info = await infoRes.json()

  // 查或建用户
  let user = await env.DB.prepare('SELECT * FROM users WHERE openid = ?').bind(openid).first()
  if (!user) {
    await env.DB.prepare(
      'INSERT INTO users (openid, nickname, avatar) VALUES (?, ?, ?)'
    ).bind(openid, info.nickname || '邻居', info.headimgurl || '').run()
    user = await env.DB.prepare('SELECT * FROM users WHERE openid = ?').bind(openid).first()
  }

  // 签发 JWT
  const token = await signJWT({ userId: user.id, openid }, env.JWT_SECRET)

  return new Response(JSON.stringify({ token, user }), { headers })
}

export async function verifyAuth(request, env) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.replace('Bearer ', '')
  if (!token) return null
  return verifyJWT(token, env.JWT_SECRET)
}

async function signJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 30 * 24 * 3600 * 1000 }))
  const sig = await hmacSign(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

async function verifyJWT(token, secret) {
  const [header, body, sig] = token.split('.')
  const expected = await hmacSign(`${header}.${body}`, secret)
  if (sig !== expected) return null
  const payload = JSON.parse(atob(body))
  if (payload.exp < Date.now()) return null
  return payload
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
