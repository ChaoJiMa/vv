import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import { toast } from '../toast'

export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuth()
  const visible = usePageVisible()

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: pollInterval(visible, 20000),
  })
  const unreadTotal = unread?.total ?? 0

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
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        maxWidth: 480,
        margin: '0 auto',
        height: 'var(--nav-height)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        background: 'color-mix(in srgb, var(--color-surface) 92%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {left.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <button
          type="button"
          aria-label="发布"
          onClick={() => go('/create', true)}
          className="nh-nav-fab"
          style={{
            width: 52,
            height: 52,
            marginTop: -18,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(145deg, #FF9A5A 0%, var(--color-primary) 100%)',
            color: 'var(--color-on-primary)',
            boxShadow: '0 6px 16px rgba(236,110,51,0.4)',
          }}
        >
          <AddIcon sx={{ fontSize: 28 }} />
        </button>
      </div>
      {right.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
      <style>{`
        .nh-nav-fab:active { transform: scale(0.92); }
        .nh-nav-item-selected .nh-nav-icon { animation: nhNavPop 280ms ease; }
        @keyframes nhNavPop {
          0% { transform: scale(1); }
          40% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-nav-item-selected .nh-nav-icon { animation: none; }
        }
      `}</style>
    </nav>
  )
}

function NavItem({ item, pathname, go }) {
  const selected = pathname === item.path
  const Icon = selected ? item.active : item.inactive
  return (
    <button
      type="button"
      onClick={() => go(item.path, item.auth)}
      className={selected ? 'nh-nav-item-selected' : undefined}
      style={{
        flex: 1,
        minHeight: 44,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        color: selected ? 'var(--color-primary)' : 'var(--color-text-muted)',
        padding: '6px 0',
      }}
    >
      <Badge color="error" badgeContent={item.badge || 0} max={99}>
        <Icon className="nh-nav-icon" sx={{ fontSize: 24 }} />
      </Badge>
      <span style={{ fontSize: 10.5, fontWeight: selected ? 700 : 400, lineHeight: 1 }}>{item.label}</span>
    </button>
  )
}
