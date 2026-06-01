const BASE = import.meta.env.VITE_API_URL || ''

function getToken() {
  return localStorage.getItem('token')
}

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
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

export const api = {
  getPosts: (type) => request(`/api/posts${type ? `?type=${type}` : ''}`),
  getPost: (id) => request(`/api/posts/${id}`),
  createPost: (body) => request('/api/posts', { method: 'POST', body: JSON.stringify(body) }),
  addComment: (id, content) => request(`/api/posts/${id}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),
  closePost: (id) => request(`/api/posts/${id}/close`, { method: 'PUT' }),
  getMe: () => request('/api/me'),
  updateMe: (body) => request('/api/me', { method: 'PUT', body: JSON.stringify(body) }),
  loginWithCode: (code) => request(`/auth/wechat?code=${code}`),
  setToken: (token) => localStorage.setItem('token', token),
  clearToken: () => localStorage.removeItem('token'),
}
