import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import InputBase from '@mui/material/InputBase'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

export default function Chat() {
  const { peerId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // 从帖子详情「私信 TA」进来时带的来源帖 id,发首条私信时记录来源
  const fromPostId = location.state?.postId
  const { user } = useAuth()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const bottomRef = useRef(null)

  // 进入会话即拉取(并在后端标记对方发我的为已读);轮询 10s 拿新消息
  const { data, isLoading } = useQuery({
    queryKey: ['thread', peerId],
    queryFn: () => api.getThread(peerId),
    enabled: !!user,
    refetchInterval: 10000,
  })
  const list = data?.list ?? []
  const peer = data?.peer

  // 拉取后未读已被后端清零,刷新首页角标与消息列表
  useEffect(() => {
    if (data) {
      qc.invalidateQueries({ queryKey: ['unread'] })
      qc.invalidateQueries({ queryKey: ['inbox'] })
    }
  }, [data, qc])

  // 新消息到达滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [list.length])

  const sendMutation = useMutation({
    mutationFn: (content) => api.sendMessage(peerId, content, fromPostId),
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: ['thread', peerId] })
      qc.invalidateQueries({ queryKey: ['inbox'] })
    },
  })

  const handleSend = () => {
    const t = text.trim()
    if (!t) return
    sendMutation.mutate(t)
  }

  if (!user) {
    return (
      <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>
        <Typography variant="body2" sx={{ mb: 2 }}>请先登录</Typography>
        <Button variant="contained" onClick={() => navigate('/login')}>去登录</Button>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'grey.50', minHeight: '100vh', pb: 9 }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ gap: 1 }}>
            <IconButton edge="start" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
            <Typography fontWeight={500}>{peer?.nickname || '邻居'}</Typography>
            {peer?.building && (
              <Typography variant="caption" color="text.secondary">{peer.building}{peer.unit || ''}</Typography>
            )}
          </Toolbar>
        </AppBar>

        {isLoading && (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={24} /></Box>
        )}
        {!isLoading && list.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>
            <Typography variant="body2">还没有消息,打个招呼吧</Typography>
          </Box>
        )}

        <Box sx={{ px: 2, py: 2 }}>
          {list.map(m => {
            const mine = m.sender_id === user.id
            return (
              <Box key={m.id} sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', mb: 1.5 }}>
                <Box
                  sx={{
                    maxWidth: '72%',
                    px: 1.5, py: 1, borderRadius: 2,
                    bgcolor: mine ? 'primary.main' : 'background.paper',
                    color: mine ? 'primary.contrastText' : 'text.primary',
                    border: mine ? 0 : 1, borderColor: 'grey.200',
                    wordBreak: 'break-word',
                  }}
                >
                  <Typography variant="body2" sx={{ lineHeight: 1.6 }}>{m.content}</Typography>
                </Box>
              </Box>
            )
          })}
          <div ref={bottomRef} />
        </Box>

        {/* 输入框 */}
        <Box sx={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, bgcolor: 'background.paper', borderTop: 1, borderColor: 'grey.100', px: 2, py: 1.5, display: 'flex', gap: 1 }}>
          <InputBase
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="发条私信..."
            sx={{ flex: 1, bgcolor: 'grey.100', borderRadius: 5, px: 2, py: 0.5, fontSize: 14 }}
          />
          <Button
            variant="contained"
            color="primary"
            onClick={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            sx={{ borderRadius: 5, minWidth: 64 }}
          >
            发送
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
