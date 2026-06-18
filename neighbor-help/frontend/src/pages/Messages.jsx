import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Avatar from '@mui/material/Avatar'
import Badge from '@mui/material/Badge'
import Button from '@mui/material/Button'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import CircularProgress from '@mui/material/CircularProgress'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'

const WARM = '#EC6E33'

// 消息页:双 Tab(私信 / 通知)。后端 inbox 返回统一流,前端按 kind 拆分到两个 Tab。
export default function Messages() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState('message') // 'message' 私信 | 'comment' 通知

  const { data, isLoading } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.getInbox(),
    enabled: !!user,
  })
  // 通知 Tab 角标:复用 unread 查询的 notiUnread
  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: 30000,
  })
  const notiUnread = unread?.notiUnread ?? 0

  const items = data?.items ?? []
  const messages = items.filter(it => it.kind === 'message')
  const notifications = items.filter(it => it.kind === 'comment')

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

  const list = tab === 'message' ? messages : notifications

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh', pb: 'calc(72px + env(safe-area-inset-bottom))' }}>
        {/* 顶部:仅标题,保持干净 */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar>
            <Typography fontWeight={600}>消息</Typography>
          </Toolbar>
          {/* 双 Tab:私信 | 通知,选中态品牌色下划线;通知带未读角标 */}
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="fullWidth"
            sx={{
              minHeight: 44,
              '& .MuiTab-root': { minHeight: 44, fontSize: 15, color: 'text.secondary' },
              '& .Mui-selected': { color: `${WARM} !important`, fontWeight: 600 },
              '& .MuiTabs-indicator': { backgroundColor: WARM },
            }}
          >
            <Tab label="私信" value="message" />
            <Tab
              value="comment"
              label={
                <Badge color="error" badgeContent={notiUnread} max={99} sx={{ '& .MuiBadge-badge': { right: -10, top: 2 } }}>
                  通知
                </Badge>
              }
            />
          </Tabs>
        </AppBar>

        {isLoading && (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={24} /></Box>
        )}

        {/* 空状态:私信 / 通知文案不同 */}
        {!isLoading && list.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 10, px: 3, color: 'text.disabled' }}>
            <Typography sx={{ fontSize: 40, mb: 1 }}>{tab === 'message' ? '📭' : '🔔'}</Typography>
            {tab === 'message' ? (
              <>
                <Typography variant="body2" sx={{ mb: 2 }}>暂无私信,去社区认识新邻居吧</Typography>
                <Button variant="outlined" onClick={() => navigate('/')} sx={{ borderColor: WARM, color: WARM, '&:hover': { borderColor: '#D85F26', bgcolor: 'transparent' } }}>
                  去首页
                </Button>
              </>
            ) : (
              <Typography variant="body2">暂无通知,有新动态时会在这里提醒你</Typography>
            )}
          </Box>
        )}

        {/* 私信列表 */}
        {!isLoading && tab === 'message' && messages.map((it) => {
          const unreadMsg = it.unread > 0
          return (
            <Box
              key={`m-${it.peerId}`}
              onClick={() => navigate(`/messages/${it.peerId}`)}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
            >
              {/* 左侧未读圆点(占位宽度,已读时透明保持对齐) */}
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: unreadMsg ? WARM : 'transparent' }} />
              <Avatar src={it.peerAvatar || undefined} sx={{ width: 44, height: 44, bgcolor: WARM, fontSize: 18 }}>
                {it.peerAvatar ? null : (it.peerName?.[0] || '邻')}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: unreadMsg ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.peerName}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.fromMe ? '我: ' : ''}{it.content}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{formatTime(it.createdAt)}</Typography>
            </Box>
          )
        })}

        {/* 通知列表 */}
        {!isLoading && tab === 'comment' && notifications.map((it) => {
          // thank:采纳并感谢;adopt:采纳;comment:评论回复
          const isThank = it.notiType === 'thank'
          const isAdopt = it.notiType === 'adopt'
          const icon = isThank ? '🙏' : isAdopt ? '✅' : '💬'
          const title = isThank
            ? `${it.actorName} 采纳并感谢了你`
            : isAdopt
              ? `${it.actorName} 采纳了你的帮助`
              : `${it.actorName} 回复了你`
          const showContent = !isThank && !isAdopt // 采纳/感谢只展示帖子标题,无评论正文
          return (
            <Box
              key={`n-${it.notificationId}`}
              onClick={() => openComment(it)}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', bgcolor: it.read ? 'transparent' : 'rgba(236,110,51,0.06)', '&:active': { bgcolor: 'grey.50' } }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: it.read ? 'transparent' : WARM }} />
              <Avatar sx={{ width: 44, height: 44, bgcolor: 'grey.200', fontSize: 20 }}>{icon}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: it.read ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {showContent ? (
                    <>
                      {it.content.slice(0, 20)}{it.content.length > 20 ? '…' : ''}
                      <Typography component="span" variant="caption" color="text.disabled"> · {it.postTitle}</Typography>
                    </>
                  ) : (
                    <Typography component="span" variant="caption" color="text.disabled">{it.postTitle}</Typography>
                  )}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{formatTime(it.createdAt)}</Typography>
            </Box>
          )
        })}
      </Box>
      <BottomNav />
    </Box>
  )
}

// 时间格式:今天显示 时:分,昨天显示"昨天",更早显示日期
function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}
