import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'

/** 列表加载失败：文案 + 重试，避免被当成空态 */
export default function ListError({ onRetry, message = '加载失败，请重试' }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{message}</Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ borderColor: '#EC6E33', color: '#EC6E33', '&:hover': { borderColor: '#D85F26', bgcolor: 'transparent' } }}>
        重试
      </Button>
    </Box>
  )
}
