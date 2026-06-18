import { useState, useEffect, useRef, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import CircularProgress from '@mui/material/CircularProgress'
import { api } from '../api'
import BottomNav from '../components/BottomNav'

const WARM = '#EC6E33'

// 发现页:固定顶部搜索 + 分类下划线 Tab + 完整动态列表(浏览所有内容)。
// 首页四大入口点击会带 location.state.type 跳来,预选对应分类。
export default function Discover() {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState(location.state?.type || '') // '' = 全部
  const [search, setSearch] = useState('') // 输入框当前值
  const [keyword, setKeyword] = useState('') // 已提交的搜索词(点按钮/回车后生效)

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['posts', activeTab, keyword],
    queryFn: ({ pageParam }) => api.getPosts(activeTab, pageParam, keyword),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const posts = data?.pages.flatMap(p => p.list) ?? []

  // 提交搜索:点击搜索按钮或回车触发(规格要求显式点击,不做防抖自动搜)
  const submitSearch = () => setKeyword(search.trim())
  const clearSearch = () => { setSearch(''); setKeyword('') }

  // 触底自动加载下一页
  const sentinelRef = useRef(null)
  const observe = useCallback((node) => {
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
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
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh', position: 'relative', pb: 'calc(72px + env(safe-area-inset-bottom))' }}>
        {/* 头部:固定顶部搜索 + 分类下划线 Tab */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ flexDirection: 'column', alignItems: 'stretch', py: 1.25, gap: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>发现</Typography>
            {/* 搜索框 + 搜索按钮 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'grey.100', borderRadius: 5, px: 1.5, py: 0.5 }}>
                <SearchIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                <InputBase
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitSearch() }}
                  placeholder="搜索帖子标题或内容"
                  sx={{ flex: 1, fontSize: 14 }}
                />
                {search && (
                  <IconButton size="small" onClick={clearSearch} sx={{ p: 0.3 }}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
              <Button
                onClick={submitSearch}
                variant="contained"
                disableElevation
                sx={{ flexShrink: 0, bgcolor: WARM, borderRadius: 5, px: 2, minWidth: 0, '&:hover': { bgcolor: '#D85F26' } }}
              >
                搜索
              </Button>
            </Box>
          </Toolbar>
          {/* 分类筛选:横向滚动 Tab,选中态品牌色下划线 */}
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="scrollable"
            scrollButtons={false}
            sx={{
              minHeight: 40,
              '& .MuiTab-root': { minHeight: 40, py: 0, fontSize: 14, color: 'text.secondary' },
              '& .Mui-selected': { color: `${WARM} !important`, fontWeight: 600 },
              '& .MuiTabs-indicator': { backgroundColor: WARM },
            }}
          >
            <Tab label="全部" value="" />
            {menus.map(m => (
              <Tab key={m.value} label={m.label} value={m.value} />
            ))}
          </Tabs>
        </AppBar>

        {isLoading && (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={24} /></Box>
        )}

        {/* 空状态:区分搜索无结果 / 该分类暂无帖子 */}
        {!isLoading && posts.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, px: 3, color: 'text.disabled' }}>
            <Typography sx={{ fontSize: 44, mb: 1 }}>{keyword ? '🔍' : '📭'}</Typography>
            {keyword ? (
              <Typography variant="body2">没有找到相关帖子,试试其他关键词</Typography>
            ) : (
              <>
                <Typography variant="body2" sx={{ mb: 2 }}>还没有帖子,去首页发布第一条吧</Typography>
                <Button variant="outlined" onClick={() => navigate('/')} sx={{ borderColor: WARM, color: WARM, '&:hover': { borderColor: '#D85F26', bgcolor: 'transparent' } }}>
                  去首页
                </Button>
              </>
            )}
          </Box>
        )}

        {/* 列表:时间倒序 */}
        {posts.map(post => {
          const menu = menuMap[post.type]
          return (
            <Box
              key={post.id}
              onClick={() => navigate(`/post/${post.id}`)}
              sx={{ px: 2, py: 1.75, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Chip label={menu?.label || post.type} color={menu?.color || 'default'} size="small" sx={{ height: 20, fontSize: 12 }} />
                {post.status === 'closed' && <Chip label="已完成" size="small" sx={{ height: 20, fontSize: 12 }} />}
              </Box>
              <Typography variant="body2" fontWeight={500} sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {post.title}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.nickname || '邻居'}
                  {(post.building || post.unit) ? ` · ${post.building || ''}${post.unit || ''}` : ''}
                  {' · '}
                  {post.last_reply_at ? `最近回复 ${formatTime(post.last_reply_at)}` : formatTime(post.created_at)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                  💬 {post.comment_count || 0}
                </Typography>
              </Box>
            </Box>
          )
        })}

        {/* 触底加载哨兵 */}
        {posts.length > 0 && (
          <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 2, color: 'text.disabled' }}>
            {isFetchingNextPage && <CircularProgress size={20} />}
            {!hasNextPage && <Typography variant="caption">没有更多了</Typography>}
          </Box>
        )}
      </Box>
      <BottomNav />
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
