import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Badge from '@mui/material/Badge'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import SearchIcon from '@mui/icons-material/Search'
import ChatBubbleIcon from '@mui/icons-material/ChatBubble'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineSharp'
import PersonIcon from '@mui/icons-material/Person'
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined'
import AddIcon from '@mui/icons-material/Add'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'

const WARM = '#EC6E33'
const WARM_DARK = '#D85F26'

// 全局底部菜单:在主页面(首页/发现/消息/我的)共用,中间为发布凸起。
// 次级页面(帖子详情/发布/聊天,带返回按钮)不挂载本组件。
// 固定视口底部,与页面容器同宽(maxWidth 480)居中对齐;消息项带未读角标。
export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuth()

  // 复用首页同款 ['unread'] 查询缓存,给消息项加红点
  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: 30000,
  })
  const unreadTotal = unread?.total ?? 0

  // 游客点需登录的入口(消息/我的/发布):给一句轻提示并带 from 跳登录,
  // 登录后跳回目标页 —— 取代 RequireAuth 的静默重定向(那样太突兀)。
  const go = (path, requireAuth) => {
    if (requireAuth && !user) {
      toast.info('登录后可用')
      navigate('/login', { state: { from: { pathname: path } } })
      return
    }
    navigate(path)
  }

  const left = [
    { key: 'home', label: '首页', path: '/', active: HomeRoundedIcon, inactive: HomeOutlinedIcon },
    { key: 'discover', label: '发现', path: '/discover', active: SearchIcon, inactive: SearchIcon },
  ]
  const right = [
    { key: 'msg', label: '消息', path: '/messages', active: ChatBubbleIcon, inactive: ChatBubbleOutlineIcon, badge: unreadTotal, auth: true },
    { key: 'me', label: '我的', path: '/profile', active: PersonIcon, inactive: PersonOutlineIcon, auth: true },
  ]

  return (
    <Box
      sx={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200,
        // 与页面容器同宽居中,宽屏下不铺满
        maxWidth: 480, mx: 'auto',
        bgcolor: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderTop: 1, borderColor: 'grey.100',
        display: 'flex', alignItems: 'stretch',
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      {left.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
      {/* 中:发布凸起按钮 */}
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Box
          onClick={() => go('/create', true)}
          sx={{
            width: 52, height: 52, mt: '-18px', borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(145deg, #FF9A5A 0%, ${WARM} 100%)`,
            color: '#fff', boxShadow: '0 6px 16px rgba(236,110,51,0.4)',
            transition: 'transform .12s',
            '&:active': { transform: 'scale(0.92)', background: WARM_DARK },
          }}
        >
          <AddIcon sx={{ fontSize: 28 }} />
        </Box>
      </Box>
      {right.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
    </Box>
  )
}

function NavItem({ item, pathname, go }) {
  const selected = pathname === item.path
  const Icon = selected ? item.active : item.inactive
  return (
    <Box
      onClick={() => go(item.path, item.auth)}
      sx={{
        flex: 1, py: 0.75, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25,
        color: selected ? WARM : 'text.secondary',
        '&:active': { opacity: 0.7 },
      }}
    >
      <Badge color="error" badgeContent={item.badge || 0} max={99}>
        <Icon sx={{ fontSize: 24 }} />
      </Badge>
      <Typography sx={{ fontSize: 10.5, fontWeight: selected ? 700 : 400, lineHeight: 1 }}>
        {item.label}
      </Typography>
    </Box>
  )
}
