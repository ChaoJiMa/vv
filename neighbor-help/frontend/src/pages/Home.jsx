import { useState, useEffect, useRef, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Fab from '@mui/material/Fab'
import AddIcon from '@mui/icons-material/Add'
import PersonIcon from '@mui/icons-material/Person'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubble'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import Badge from '@mui/material/Badge'
import CircularProgress from '@mui/material/CircularProgress'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

export default function Home() {
  const [activeTab, setActiveTab] = useState('')
  const [search, setSearch] = useState('')      // 输入框即时值
  const [keyword, setKeyword] = useState('')    // debounce 后用于查询的值
  const navigate = useNavigate()
  const { user } = useAuth()

  // 输入停顿 400ms 再触发查询,避免每敲一键都打一次接口
  useEffect(() => {
    const t = setTimeout(() => setKeyword(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])

  // 菜单由后端返回
  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })

  // 未读消息数(私信 + 评论通知):仅登录时轮询,给消息图标加红点角标
  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: 30000,
  })
  const unreadTotal = unread?.total ?? 0

  // value -> 菜单项,便于列表渲染标签/颜色
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['posts', activeTab, keyword],
    queryFn: ({ pageParam }) => api.getPosts(activeTab, pageParam, keyword),
    initialPageParam: 1,
    // 后端返回 { list, total, page, hasMore },直接据 hasMore 判断是否还有下一页
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
  })

  const posts = data?.pages.flatMap(p => p.list) ?? []

  // 触底自动加载下一页
  const sentinelRef = useRef(null)
  const observe = useCallback((node) => {
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }, { rootMargin: '200px' })
    io.observe(node)
    return io
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    const io = observe(sentinelRef.current)
    return () => io?.disconnect()
  }, [observe])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh', position: 'relative', pb: 10 }}>
        {/* 头部 */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ flexDirection: 'row', alignItems: 'center', py: 1 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>邻里互助</Typography>
              <Typography variant="caption" color="text.secondary">小区邻居互帮互助平台</Typography>
            </Box>
            {user && (
              <IconButton onClick={() => navigate('/messages')}>
                <Badge color="error" badgeContent={unreadTotal}>
                  <ChatBubbleOutlineIcon />
                </Badge>
              </IconButton>
            )}
            <IconButton onClick={() => user ? navigate('/profile') : navigate('/login')}>
              <PersonIcon />
            </IconButton>
          </Toolbar>
          {/* 搜索框:按标题/内容模糊搜索,输入 debounce */}
          <Box sx={{ px: 2, pb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'grey.100', borderRadius: 5, px: 1.5, py: 0.5 }}>
              <SearchIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
              <InputBase
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索帖子标题或内容"
                sx={{ flex: 1, fontSize: 14 }}
              />
              {search && (
                <IconButton size="small" onClick={() => setSearch('')} sx={{ p: 0.3 }}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
          </Box>
          {/* Tab 栏:全部 + 后端菜单 */}
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="scrollable"
            scrollButtons={false}
            sx={{ borderTop: 1, borderColor: 'grey.100', minHeight: 44 }}
          >
            <Tab label="全部" value="" sx={{ minHeight: 44 }} />
            {menus.map(m => (
              <Tab key={m.value} label={m.label} value={m.value} sx={{ minHeight: 44 }} />
            ))}
          </Tabs>
        </AppBar>

        {/* 帖子列表 */}
        {isLoading && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {!isLoading && posts.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
            <Typography sx={{ fontSize: 40, mb: 1 }}>{keyword ? '🔍' : '🏠'}</Typography>
            <Typography variant="body2">
              {keyword ? `没有找到与"${keyword}"相关的帖子` : '还没有帖子，来发第一条吧'}
            </Typography>
          </Box>
        )}
        <Box>
          {posts.map(post => {
            const menu = menuMap[post.type]
            return (
              <Box
                key={post.id}
                onClick={() => navigate(`/post/${post.id}`)}
                sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Chip
                    label={menu?.label || post.type}
                    color={menu?.color || 'default'}
                    size="small"
                    sx={{ height: 20, fontSize: 12 }}
                  />
                  {post.status === 'closed' && (
                    <Chip label="已完成" size="small" sx={{ height: 20, fontSize: 12 }} />
                  )}
                </Box>
                <Typography variant="body2" fontWeight={500} sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {post.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {post.building || ''}{post.unit || ''}邻居 · {formatTime(post.created_at)}
                  {post.comment_count > 0 && ` · 💬 ${post.comment_count}`}
                </Typography>
              </Box>
            )
          })}
        </Box>

        {/* 触底加载哨兵 + 加载指示 */}
        {posts.length > 0 && (
          <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 2, color: 'text.disabled' }}>
            {isFetchingNextPage && <CircularProgress size={20} />}
            {!hasNextPage && <Typography variant="caption">没有更多了</Typography>}
          </Box>
        )}

        {/* 发帖按钮 */}
        <Fab
          color="primary"
          onClick={() => user ? navigate('/create') : navigate('/login')}
          sx={{ position: 'fixed', bottom: 24, right: 24 }}
        >
          <AddIcon />
        </Fab>
      </Box>
    </Box>
  )
}

function formatTime(ts) {
  const d = new Date(ts) // created_at 现为毫秒时间戳,无需 *1000
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  // 跨年的帖子带上年份,避免"1月2日"无法区分是哪一年
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}
