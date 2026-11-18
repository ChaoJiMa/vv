// 会话快照同时比较 token 与修订号，阻止切换账号后旧请求回写新账号状态。
let revision = 0
let observedToken = localStorage.getItem('token')
const listeners = new Set()

// 返回当前凭据和本页修订号；直接变更 localStorage 时也推进修订号。
export function captureSession() {
  const token = localStorage.getItem('token')
  if (token !== observedToken) {
    observedToken = token
    revision++
  }
  return { token, revision }
}

export function isSessionCurrent(session) {
  const current = captureSession()
  return !!session && session.token === current.token && session.revision === current.revision
}

export class StaleSessionError extends Error {
  constructor() {
    super('登录状态已改变，请重试')
    this.name = 'StaleSessionError'
  }
}

export function assertSessionCurrent(session) {
  if (!isSessionCurrent(session)) throw new StaleSessionError()
}

// expected 可限制仅更新原会话；返回是否写入，restore 控制订阅者是否恢复用户资料。
export function setSessionToken(token, expected, { restore = true } = {}) {
  if (expected && !isSessionCurrent(expected)) return false
  if (token) localStorage.setItem('token', token)
  else localStorage.removeItem('token')
  observedToken = token || null
  revision++
  for (const listener of listeners) listener({ session: captureSession(), restore })
  return true
}

// 同步本页与其他标签页的会话变更，返回取消订阅函数。
export function subscribeSession(listener) {
  const storageChanged = (event) => {
    if (event.storageArea && event.storageArea !== localStorage) return
    if (event.key !== 'token' && event.key !== null) return
    // 事件可能排队；读取当前存储，避免恢复过时的事件值。
    listener({ session: captureSession(), restore: true })
  }
  listeners.add(listener)
  window.addEventListener('storage', storageChanged)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', storageChanged)
  }
}
