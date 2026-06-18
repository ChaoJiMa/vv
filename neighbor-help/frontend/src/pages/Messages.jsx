import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Avatar from '@mui/material/Avatar'
import Badge from '@mui/material/Badge'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

// 统一消息流:私信会话(kind=message)与评论通知(kind=comment)按时间倒序混排。
export default function Messages() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.getInbox(),
    enabled: !!user,
  })
  const items = data?.items ?? []

  // 点开评论通知:标记该通知已读后跳到帖子
  const readNoti = useMutation({
    mutationFn: (id) => api.readNotification(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] })
      qc.invalidateQueries({ queryKey: ['unread'] })
    },
  })

  if (!user) {
    return (
      <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>
        <Typography variant="body2" sx={{ mb: 2 }}>请先登录</Typography>
        <Button variant="contained" onClick={() => navigate('/login')}>去登录</Button>
      </Box>
    )
  }

  const openComment = (it) => {
    if (!it.read) readNoti.mutate(it.notificationId)
    if (it.postId) navigate(`/post/${it.postId}`)
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ gap: 1 }}>
            <IconButton edge="start" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
            <Typography fontWeight={500}>消息</Typography>
          </Toolbar>
        </AppBar>

        {isLoading && (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={24} /></Box>
        )}
        {!isLoading && items.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>
            <Typography sx={{ fontSize: 40, mb: 1 }}>📭</Typography>
            <Typography variant="body2">还没有消息</Typography>
          </Box>
        )}

        {items.map((it) => it.kind === 'message' ? (
          <Box
            key={`m-${it.peerId}`}
            onClick={() => navigate(`/messages/${it.peerId}`)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
          >
            <Badge color="error" badgeContent={it.unread} overlap="circular">
              <Avatar src={it.peerAvatar || undefined} sx={{ width: 44, height: 44, bgcolor: 'primary.light' }}>
                {it.peerAvatar ? null : '💬'}
              </Avatar>
            </Badge>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={500} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.peerName}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.fromMe ? '我: ' : ''}{it.content}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{formatTime(it.createdAt)}</Typography>
          </Box>
        ) : (
          <Box
            key={`n-${it.notificationId}`}
            onClick={() => openComment(it)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', bgcolor: it.read ? 'transparent' : 'success.50', '&:active': { bgcolor: 'grey.50' } }}
          >
            <Badge color="error" variant="dot" invisible={it.read} overlap="circular">
              <Avatar sx={{ width: 44, height: 44, bgcolor: 'grey.300', fontSize: 20 }}>✏️</Avatar>
            </Badge>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={500} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.actorName} 回复了你的评论
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.content.slice(0, 20)}{it.content.length > 20 ? '…' : ''}
                <Typography component="span" variant="caption" color="text.disabled"> · {it.postTitle}</Typography>
              </Typography>
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{formatTime(it.createdAt)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}
