import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // 仅当本地有 token 时才需要异步恢复登录态而进入 loading;无 token 时初始即就绪,
  // 避免在 effect 中同步 setState 触发级联渲染。
  const [loading, setLoading] = useState(() => !!localStorage.getItem('token'))

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      api.getMe().then(setUser).catch(() => api.clearToken()).finally(() => setLoading(false))
    }
  }, [])

  const login = (token, userData) => {
    api.setToken(token)
    setUser(userData)
  }

  const logout = () => {
    // 先请求后端吊销 token(token_version+1),无论成败都清除本地登录态。
    // silentError 已在 api.logout 内置,这里吞掉异常避免影响登出体验。
    api.logout().catch(() => {})
    api.clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook 与 Provider 紧耦合,同文件导出
export const useAuth = () => useContext(AuthContext)
