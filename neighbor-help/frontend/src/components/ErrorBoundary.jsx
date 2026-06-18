import { Component } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'

// 全局错误边界:捕获懒加载失败 / 渲染异常,避免整页白屏。
// React 错误边界必须是 class 组件(无 hooks 等价物)。
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // 仅打印到控制台便于排查;生产可接入上报
    console.error('[ErrorBoundary]', error, info)
  }

  handleReload = () => {
    // 重置状态并刷新,通常能恢复(如 chunk 加载失败重新拉取)
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', px: 3, gap: 2 }}>
          <Typography variant="h6">页面出了点问题</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            请刷新重试,如果反复出现可稍后再来。
          </Typography>
          <Button variant="contained" color="primary" onClick={this.handleReload}>刷新页面</Button>
        </Box>
      )
    }
    return this.props.children
  }
}
