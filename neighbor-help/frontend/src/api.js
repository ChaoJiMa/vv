import { toast } from './toast'

const BASE = import.meta.env.VITE_API_URL || ''

function getToken() {
  return localStorage.getItem('token')
}

// 后端统一返回 { code, message, data }:code===200 成功,返回 data;否则视为失败。
// 失败默认 toast 弹窗提示 message,调用方可传 { silentError: true } 关闭(自行处理错误展示)。
async function request(path, options = {}) {
  const token = getToken()
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  const message = body.message || '请求失败'

  // token 失效/过期:清除本地登录态。
  // silentAuth(如挂载时恢复登录态)只清 token、留在当前页;用户主动操作才跳登录页。
  // 已在登录页时不跳,避免循环。
  if (res.status === 401 || body.code === 401) {
    localStorage.removeItem('token')
    if (!options.silentAuth) {
      if (!options.silentError) toast.error('登录已过期，请重新登录')
      if (!location.pathname.startsWith('/login')) location.href = '/login'
    }
    const err = new Error(message)
    err.code = 401
    throw err
  }

  if (body.code !== 200) {
    if (!options.silentError) toast.error(message)
    const err = new Error(message)
    err.code = body.code
    throw err
  }

  return body.data
}

// 所有业务接口统一用 POST + body 传参,靠动词后缀路径区分。
// 便捷封装:post(path, body) 自动序列化 body。
function post(path, body, options = {}) {
  return request(path, { method: 'POST', body: JSON.stringify(body || {}), ...options })
}

export const api = {
  getMenus: () => post('/api/menus/list'),
  getPosts: (type, page = 1, keyword = '') => post('/api/posts/list', { type, page, keyword }),
  getPost: (id) => post('/api/posts/detail', { id }),
  createPost: (body) => post('/api/posts/create', body),
  updatePost: (id, body) => post('/api/posts/update', { id, ...body }),
  deletePost: (id) => post('/api/posts/delete', { id }),
  addComment: (id, content) => post('/api/posts/comment', { id, content }),
  deleteComment: (id) => post('/api/posts/comment/delete', { id }),
  closePost: (id, helpers) => post('/api/posts/close', { id, helpers }),
  respondPost: (id) => post('/api/posts/respond', { id }),
  unrespondPost: (id) => post('/api/posts/unrespond', { id }),
  getHelperCandidates: (id) => post('/api/posts/helpers/candidates', { id }),
  getMe: () => post('/api/me/get', {}, { silentAuth: true, silentError: true }),
  getMyPosts: (page = 1, status = '') => post('/api/me/posts', { page, status }),
  getMyStats: () => post('/api/me/stats'),
  updateMe: (body) => post('/api/me/update', body),
  changePassword: (body) => post('/api/me/password', body),
  logout: () => post('/api/me/logout', {}, { silentError: true }),
  // 私信 / 通知
  sendMessage: (receiverId, content, postId) => post('/api/messages/send', { receiverId, content, postId }),
  getThread: (peerId, page = 1) => post('/api/messages/thread', { peerId, page }),
  getInbox: () => post('/api/messages/inbox'),
  getUnread: () => post('/api/messages/unread', {}, { silentAuth: true, silentError: true }),
  readNotification: (id) => post('/api/notifications/read', { id }),
  register: (body) => post('/auth/register', body),
  loginWithPassword: (body) => post('/auth/login', body),
  loginWithCode: (code) => post('/auth/wechat', { code }),
  setToken: (token) => localStorage.setItem('token', token),
  clearToken: () => localStorage.removeItem('token'),
}
