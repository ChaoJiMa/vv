import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Loading from './Loading'

// 路由权限守卫:包裹除 /login 外的全部路由。
// 关键:必须等 loading 结束再判断 —— 刷新页面时 useAuth 正用本地 token 异步恢复登录态,
// 此刻 user 还是 null,若直接判定未登录会把已登录用户错误跳走。
export default function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loading />
  // 未登录:记录原目标(含查询串)到 state.from,登录后跳回;replace 避免历史里留下被拦地址
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <Outlet />
}
