import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { captureSession, isSessionCurrent, setSessionToken, subscribeSession } from '../session'

const AuthContext = createContext(null)

// StrictMode 双挂载时复用同一次 getMe，避免开发态双打 /api/me/get
let meInflight = null
function fetchMeShared(session) {
  if (!meInflight || !isSessionCurrent(meInflight.session)) {
    const entry = { session }
    entry.promise = api.getMe().finally(() => { if (meInflight === entry) meInflight = null })
    meInflight = entry
  }
  return meInflight.promise
}

export function AuthProvider({ children }) {
  const qc = useQueryClient()
  const [user, setUser] = useState(null)
  const [restoreError, setRestoreError] = useState(null)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  // 仅当本地有 token 时才需要异步恢复登录态而进入 loading;无 token 时初始即就绪,
  // 避免在 effect 中同步 setState 触发级联渲染。
  const [loading, setLoading] = useState(() => !!localStorage.getItem('token'))

  useEffect(() => subscribeSession(({ session, restore }) => {
    qc.clear()
    setRestoreError(null)
    setLoading(restore && !!session.token)
    if (restore) {
      setUser(null)
      setRestoreAttempt(attempt => attempt + 1)
    }
  }), [qc])

  useEffect(() => {
    const session = captureSession()
    if (!session.token) return undefined
    let cancelled = false
    const current = () => !cancelled && isSessionCurrent(session)
    fetchMeShared(session)
      .then((u) => {
        if (!current()) return
        setUser(u)
        setRestoreError(null)
      })
      .catch((error) => {
        if (!current()) return
        if (error.code === 401) {
          setSessionToken(null, session)
          qc.clear()
          setUser(null)
          setRestoreError(null)
        } else {
          setRestoreError(error)
        }
      })
      .finally(() => { if (current()) setLoading(false) })
    return () => { cancelled = true }
  }, [qc, restoreAttempt])

  const retrySession = useCallback(() => {
    if (!localStorage.getItem('token')) return
    setLoading(true)
    setRestoreError(null)
    setRestoreAttempt(attempt => attempt + 1)
  }, [])

  useEffect(() => {
    if (!restoreError) return undefined
    window.addEventListener('online', retrySession)
    return () => window.removeEventListener('online', retrySession)
  }, [restoreError, retrySession])

  const login = (token, userData) => {
    qc.clear()
    setSessionToken(token, undefined, { restore: false })
    setRestoreError(null)
    setLoading(false)
    setUser(userData)
  }

  const logout = () => {
    // 先请求后端吊销 token(token_version+1),无论成败都清除本地登录态。
    // silentError 已在 api.logout 内置,这里吞掉异常避免影响登出体验。
    api.logout().catch(() => {})
    setSessionToken(null)
    qc.clear()
    setRestoreError(null)
    setLoading(false)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, restoreError, retrySession, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook 与 Provider 紧耦合,同文件导出
export const useAuth = () => useContext(AuthContext)
