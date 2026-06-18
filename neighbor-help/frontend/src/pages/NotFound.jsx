import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'

// 404:匹配不到任何已知路由时显示(catch-all),提供返回首页入口
export default function NotFound() {
  const navigate = useNavigate()
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 3, textAlign: 'center' }}>
      <Typography sx={{ fontSize: 80, fontWeight: 800, lineHeight: 1, color: '#EC6E33' }}>404</Typography>
      <Typography sx={{ fontSize: 16, color: 'text.secondary' }}>页面不存在或已被移除</Typography>
      <Button
        variant="contained"
        onClick={() => navigate('/', { replace: true })}
        sx={{ mt: 1.5, bgcolor: '#EC6E33', borderRadius: '10px', boxShadow: 'none', '&:hover': { bgcolor: '#D85F26', boxShadow: 'none' } }}
      >
        返回首页
      </Button>
    </Box>
  )
}
