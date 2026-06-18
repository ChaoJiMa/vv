import { useState, useEffect, useRef, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Fab from '@mui/material/Fab'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineRounded'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { safeParse } from '../utils/image'
import BottomNav from '../components/BottomNav'

// 品牌暖橙(与登录页统一)
const WARM = '#EC6E33'
const WARM_DARK = '#D85F26'

// 顶部滚动公告(后端暂无公告接口,先用静态文案,后续接 /api/announcements 即可替换)
const NOTICES = [
  '欢迎来到邻里里,远亲不如近邻 🏠',
  '文明互助,共建友善社区 🌱',
  '交易注意安全,谨防诈骗 ⚠️',
]

// 新手必读 / 风险告知(悬浮帮助入口里展示)
const SAFETY_TIPS = [
  { icon: '🔒', text: '见面交易选在小区公共区域,结伴更安心' },
  { icon: '💰', text: '大额交易当面验货,警惕预付定金类骗局' },
  { icon: '📵', text: '不向陌生人透露验证码、银行卡等敏感信息' },
  { icon: '🤝', text: '文明互助、理性沟通,共建友善邻里关系' },
]

export default function Home() {
  const [helpOpen, setHelpOpen] = useState(false) // 悬浮帮助弹窗
  const navigate = useNavigate()
  const { user } = useAuth()

  // 菜单由后端返回(4 类服务,带 icon/label/desc/color)
  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  // 热度数据源:独立拉一次「全部」最近列表,统计每类近期条数,给入口卡角标用
  const { data: hotData } = useQuery({
    queryKey: ['posts-hot'],
    queryFn: () => api.getPosts('', 1, ''),
    staleTime: 60 * 1000,
  })
  const hotByType = {}
  ;(hotData?.list ?? []).forEach(p => { hotByType[p.type] = (hotByType[p.type] || 0) + 1 })

  // 首页动态:最新全部帖子流(不带筛选,筛选/搜索在发现页)
  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['posts', '', ''],
    queryFn: ({ pageParam }) => api.getPosts('', pageParam, ''),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const posts = data?.pages.flatMap(p => p.list) ?? []
  const total = data?.pages?.[0]?.total ?? 0
  const todayCount = posts.filter(p => isToday(p.created_at)).length

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

  // 点击四功能入口:跳发现页并预选该分类
  const onPickCategory = (value) => navigate('/discover', { state: { type: value } })

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh', position: 'relative', pb: 'calc(80px + env(safe-area-inset-bottom))' }}>
        {/* 头部:品牌(消息/个人入口在底部菜单) */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ py: 1 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>邻里里</Typography>
              <Typography variant="caption" color="text.secondary">远亲不如近邻</Typography>
            </Box>
            {/* 游客:右上角登录入口(已登录则隐藏,个人入口在底部菜单) */}
            {!user && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => navigate('/login')}
                sx={{ ml: 'auto', borderColor: WARM, color: WARM, '&:hover': { borderColor: WARM_DARK, bgcolor: 'transparent' } }}
              >
                登录
              </Button>
            )}
          </Toolbar>
        </AppBar>

        {/* ===== 区域 1:滚动公告 + 今日动态卡 ===== */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, bgcolor: '#FFF6EC', overflow: 'hidden' }}>
          <CampaignOutlinedIcon sx={{ fontSize: 18, color: WARM, flexShrink: 0 }} />
          <Box sx={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <Box
              sx={{
                display: 'inline-block', whiteSpace: 'nowrap',
                animation: 'noticeScroll 18s linear infinite',
                '@keyframes noticeScroll': {
                  '0%': { transform: 'translateX(0)' },
                  '100%': { transform: 'translateX(-50%)' },
                },
                '&:hover': { animationPlayState: 'paused' },
              }}
            >
              {[...NOTICES, ...NOTICES].map((n, i) => (
                <Typography key={i} component="span" sx={{ fontSize: 12.5, color: 'text.secondary', mr: 5 }}>
                  {n}
                </Typography>
              ))}
            </Box>
          </Box>
        </Box>

        {/* 今日动态卡:暖橙渐变 + 数据 + 行动引导 + 发布按钮 */}
        <Box sx={{ px: 2, pt: 2 }}>
          <Box
            sx={{
              position: 'relative', overflow: 'hidden',
              borderRadius: '16px', p: 2.25, color: '#fff',
              background: `linear-gradient(135deg, ${WARM} 0%, #FF8A6B 100%)`,
              boxShadow: '0 8px 24px rgba(236,110,51,0.28)',
            }}
          >
            <Box sx={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.16)' }} />
            <Typography sx={{ fontSize: 13, opacity: 0.9, position: 'relative' }}>今日动态</Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.5, position: 'relative' }}>
              <Typography sx={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{todayCount}</Typography>
              <Typography sx={{ fontSize: 14, opacity: 0.92 }}>条新发布 · 社区累计 {total} 条</Typography>
            </Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, mt: 1, position: 'relative' }}>
              有需要别自己扛,发一条让邻居搭把手 👋
            </Typography>
            <Button
              onClick={() => navigate('/create')}
              endIcon={<ArrowForwardIcon sx={{ fontSize: 18 }} />}
              sx={{
                mt: 1.25, position: 'relative',
                bgcolor: 'rgba(255,255,255,0.95)', color: WARM_DARK,
                fontSize: 13.5, fontWeight: 700, borderRadius: '10px',
                px: 2, py: 0.75, boxShadow: 'none',
                '&:hover': { bgcolor: '#fff', boxShadow: 'none' },
              }}
            >
              发布求助,让邻居帮你
            </Button>
          </Box>
        </Box>

        {/* ===== 区域 2:四功能入口 2×2 卡片 + 热度角标(点击跳发现页预选分类) ===== */}
        <Box sx={{ px: 2, pt: 2.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
            {menus.map(m => {
              const hot = hotByType[m.value] || 0
              return (
                <Box
                  key={m.value}
                  onClick={() => onPickCategory(m.value)}
                  sx={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center', gap: 1.25,
                    p: 1.5, borderRadius: '14px', cursor: 'pointer',
                    border: '1.5px solid', borderColor: 'grey.200',
                    bgcolor: 'background.paper',
                    transition: 'border-color .15s, background-color .15s',
                    '&:active': { bgcolor: 'rgba(236,110,51,0.08)' },
                  }}
                >
                  {/* 热度角标:有近期活跃帖显示数字,否则灰点提示 */}
                  {hot > 0 ? (
                    <Box
                      sx={{
                        position: 'absolute', top: 8, right: 8,
                        minWidth: 18, height: 18, px: 0.6, borderRadius: '9px',
                        bgcolor: WARM, color: '#fff', fontSize: 10.5, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {hot > 99 ? '99+' : hot}
                    </Box>
                  ) : (
                    <Box sx={{ position: 'absolute', top: 11, right: 11, width: 6, height: 6, borderRadius: '50%', bgcolor: 'grey.300' }} />
                  )}
                  <Box
                    sx={{
                      width: 40, height: 40, borderRadius: '12px', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22,
                      bgcolor: (theme) => `${theme.palette[m.color]?.main || theme.palette.primary.main}1A`,
                    }}
                  >
                    {m.icon}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{m.label}</Typography>
                    <Typography sx={{ fontSize: 11, color: hot > 0 ? WARM : 'text.secondary', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hot > 0 ? `近期 ${hot} 条在求助` : m.desc}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* ===== 区域 3:邻里动态(最新流) ===== */}
        <Box sx={{ px: 2, pt: 3, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>邻里动态</Typography>
            <Typography onClick={() => navigate('/discover')} sx={{ fontSize: 12.5, color: WARM, cursor: 'pointer' }}>
              全部浏览
            </Typography>
          </Box>
        </Box>

        {isLoading && (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={24} /></Box>
        )}

        {/* 空态:icon + 文案 + 发布按钮 */}
        {!isLoading && posts.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
            <Typography sx={{ fontSize: 52, mb: 1.5 }}>📝</Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 2.5 }}>
              还没有帖子,发布第一个求助让邻居帮你!
            </Typography>
            <Button
              variant="contained"
              onClick={() => navigate('/create')}
              startIcon={<AddIcon />}
              sx={{ bgcolor: WARM, borderRadius: '10px', fontWeight: 700, boxShadow: 'none', px: 2.5, '&:hover': { bgcolor: WARM_DARK, boxShadow: 'none' } }}
            >
              发布求助
            </Button>
          </Box>
        )}

        {/* 列表:时间倒序 */}
        {posts.map(post => {
          const menu = menuMap[post.type]
          const thumb = safeParse(post.images)[0]
          return (
            <Box
              key={post.id}
              onClick={() => navigate(`/post/${post.id}`)}
              sx={{ px: 2, py: 1.75, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
            >
              <Box sx={{ display: 'flex', gap: 1.25 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Chip label={menu?.label || post.type} color={menu?.color || 'default'} size="small" sx={{ height: 20, fontSize: 12 }} />
                    {post.status === 'closed' && <Chip label="已完成" size="small" sx={{ height: 20, fontSize: 12 }} />}
                  </Box>
                  <Typography variant="body2" fontWeight={500} sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {post.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    {post.building || ''}{post.unit || ''}邻居 · {formatTime(post.created_at)}
                    {post.comment_count > 0 && ` · 💬 ${post.comment_count}`}
                  </Typography>
                </Box>
                {thumb && (
                  <Box
                    component="img"
                    src={api.imgUrl(thumb)}
                    alt=""
                    loading="lazy"
                    sx={{ width: 72, height: 72, flexShrink: 0, borderRadius: 2, objectFit: 'cover', bgcolor: 'grey.100' }}
                  />
                )}
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

        {/* 区域 4:新手必读 → 悬浮帮助入口(置于底部菜单之上) */}
        <Fab
          size="small"
          onClick={() => setHelpOpen(true)}
          sx={{ position: 'fixed', bottom: 'calc(84px + env(safe-area-inset-bottom))', right: 16, bgcolor: '#fff', color: WARM, boxShadow: '0 4px 16px rgba(0,0,0,0.16)', '&:hover': { bgcolor: '#FFF6EC' } }}
        >
          <HelpOutlineIcon />
        </Fab>

        {/* 帮助弹窗:新手必读 / 安全提示 */}
        <Drawer
          anchor="bottom"
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          slotProps={{
            paper: {
              sx: {
                width: '100%', maxWidth: 480, mx: 'auto',
                borderRadius: '20px 20px 0 0', px: 3, pt: 2.5,
                pb: 'calc(24px + env(safe-area-inset-bottom))',
              },
            },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              📖 新手必读 · 安全提示
            </Typography>
            <IconButton onClick={() => setHelpOpen(false)} sx={{ width: 28, height: 28, bgcolor: '#F4EEE7', color: '#8E8E93' }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {SAFETY_TIPS.map((t, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                <Typography sx={{ fontSize: 18, lineHeight: 1.4, flexShrink: 0 }}>{t.icon}</Typography>
                <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.5 }}>{t.text}</Typography>
              </Box>
            ))}
          </Box>
        </Drawer>
      </Box>

      {/* 全局底部菜单 */}
      <BottomNav />
    </Box>
  )
}

// 判断时间戳是否在今天(本地时区)
function isToday(ts) {
  const d = new Date(ts)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function formatTime(ts) {
  const d = new Date(ts) // created_at 现为毫秒时间戳,无需 *1000
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}
