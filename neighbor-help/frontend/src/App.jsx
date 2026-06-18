import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'
import { AuthProvider } from './hooks/useAuth'
import ToastProvider from './components/ToastProvider'
import ErrorBoundary from './components/ErrorBoundary'

// 路由级代码分割:每个页面单独打包,首屏只加载当前路由
const Home = lazy(() => import('./pages/Home'))
const PostDetail = lazy(() => import('./pages/PostDetail'))
const CreatePost = lazy(() => import('./pages/CreatePost'))
const Login = lazy(() => import('./pages/Login'))
const Profile = lazy(() => import('./pages/Profile'))
const Messages = lazy(() => import('./pages/Messages'))
const Chat = lazy(() => import('./pages/Chat'))

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

// 主题主色沿用原绿色调
const theme = createTheme({
  palette: { primary: { main: '#22c55e' } },
})

const Loading = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
    <CircularProgress size={28} />
  </Box>
)

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/post/:id" element={<PostDetail />} />
                  <Route path="/create" element={<CreatePost />} />
                  <Route path="/edit/:id" element={<CreatePost />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/messages" element={<Messages />} />
                  <Route path="/messages/:peerId" element={<Chat />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
            <ToastProvider />
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
