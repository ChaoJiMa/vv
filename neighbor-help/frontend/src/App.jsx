import { lazy, Suspense, useMemo } from 'react'
import { createBrowserRouter, createRoutesFromElements, Outlet, Route, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { AuthProvider } from './hooks/useAuth'
import { AppThemeProvider } from './theme/ThemeProvider'
import { useAppTheme } from './theme/useAppTheme'
import ToastProvider from './components/ToastProvider'
import ErrorBoundary from './components/ErrorBoundary'
import RequireAuth from './components/RequireAuth'
import Loading from './components/Loading'
import ChromePad from './components/ChromePad'
import RouteError from './components/RouteError'

// 路由级代码分割:每个页面单独打包,首屏只加载当前路由
const Home = lazy(() => import('./pages/Home'))
const Discover = lazy(() => import('./pages/Discover'))
const PostDetail = lazy(() => import('./pages/PostDetail'))
const CreatePost = lazy(() => import('./pages/CreatePost'))
const Login = lazy(() => import('./pages/Login'))
const Profile = lazy(() => import('./pages/Profile'))
const Messages = lazy(() => import('./pages/Messages'))
const Chat = lazy(() => import('./pages/Chat'))
const NotFound = lazy(() => import('./pages/NotFound'))
// 素材组合只在本地开发开放，不进入生产导航或构建资源。
const CharacterPlayground = import.meta.env.DEV ? lazy(() => import('./dev/CharacterPlayground')) : null
// 公告管理改走独立管理后台，H5 不再挂路由

// 默认重试策略:只要后端给出了明确响应(error.code 存在),除 500 外一律不重试 ——
// 4xx、限流(429)、业务错误(10xx/20xx)重试也是同样结果,徒增请求。
// 仅网络中断(无 code)或 500 这类可能瞬时恢复的错误重试,最多 2 次。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const code = error?.code
        if (typeof code === 'number' && code !== 500) return false
        return failureCount < 2
      },
    },
  },
})

// MUI 需要真实色值生成悬停/禁用等派生色；控件色与 tokens.css 保持一致。
// 不能把 CSS 变量直接传给 palette，否则控件内部的颜色计算无法解析。
const MUI_PALETTES = {
  light: {
    primary: { main: '#242326', contrastText: '#ffffff' },
    background: { default: '#f9f9f9', paper: '#ffffff' },
    text: { primary: '#242326', secondary: '#55515d' },
    divider: 'rgba(36, 35, 38, 0.1)',
    error: { main: '#ba3450' },
  },
  dark: {
    primary: { main: '#faf5fc', contrastText: '#24202a' },
    background: { default: '#201e25', paper: '#2d2933' },
    text: { primary: '#faf5fc', secondary: '#d2c9d9' },
    divider: 'rgba(250, 245, 252, 0.13)',
    error: { main: '#ff8a9b' },
  },
}

/**
 * 读取应用已解析的明暗主题并桥接 MUI；仅换配色，不重建路由或查询客户端。
 * 主题对象只在明暗变化时更新，避免页面普通渲染反复生成控件样式。
 */
function AppMuiTheme({ children }) {
  const { theme: mode } = useAppTheme()
  const theme = useMemo(() => createTheme({
    palette: { mode, ...MUI_PALETTES[mode] },
    // CSSBaseline 也使用页面 token，避免其注入的 body 规则另行维护背景颜色。
    components: { MuiCssBaseline: { styleOverrides: { body: { backgroundColor: 'var(--color-bg)' } } } },
  }), [mode])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

/** 产品页面共用稳定会话布局；开发素材预览不进入该分支，避免有本地凭据时也请求恢复账号。 */
function ProductSessionLayout() {
  return <AuthProvider><Outlet /></AuthProvider>
}

// 数据路由提供 useBlocker：发布页可统一拦截底栏切换与浏览器返回。
// 产品错误边界位于会话布局内部，页面失败与恢复也不重建账号上下文。
const router = createBrowserRouter(createRoutesFromElements(
  <Route errorElement={<RouteError />}>
    {import.meta.env.DEV && <Route path="/dev/characters" element={<CharacterPlayground />} />}
    <Route element={<ProductSessionLayout />}>
      <Route errorElement={<RouteError />}>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/note/:id" element={<PostDetail />} />
        <Route element={<RequireAuth />}>
          <Route path="/create" element={<CreatePost />} />
          <Route path="/edit/:id" element={<CreatePost />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:conversationId" element={<Chat />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
  </Route>,
))

export default function App() {
  return (
    <AppThemeProvider>
      <AppMuiTheme>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <ChromePad />
            <Suspense fallback={<Loading />}>
              <RouterProvider router={router} />
            </Suspense>
            <ToastProvider />
          </QueryClientProvider>
        </ErrorBoundary>
      </AppMuiTheme>
    </AppThemeProvider>
  )
}
