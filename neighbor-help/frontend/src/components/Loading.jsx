import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'

// 全屏居中加载态:Suspense 路由切换 fallback 与 RequireAuth 恢复登录态的等待态共用
export default function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <CircularProgress size={28} />
    </Box>
  )
}
