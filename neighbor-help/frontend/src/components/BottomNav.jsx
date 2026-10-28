import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Badge from '@mui/material/Badge'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import { toast } from '../toast'
import {
  NavHomeIcon, NavDiscoverIcon, NavMessageIcon, NavMeIcon, NavAddIcon,
} from './icons'

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
    { key: 'home', label: '首页', path: '/', Icon: NavHomeIcon },
    { key: 'discover', label: '发现', path: '/discover', Icon: NavDiscoverIcon },
  ]
  const right = [
    { key: 'msg', label: '消息', path: '/messages', Icon: NavMessageIcon, badge: unreadTotal, auth: true },
    { key: 'me', label: '我的', path: '/profile', Icon: NavMeIcon, auth: true },
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
          <NavAddIcon size={28} />
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
  const Icon = item.Icon
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
        <span className="nh-nav-icon" style={{ display: 'inline-flex' }}>
          <Icon size={24} filled={selected} />
        </span>
      </Badge>
      <span style={{ fontSize: 10.5, fontWeight: selected ? 700 : 400, lineHeight: 1 }}>{item.label}</span>
    </button>
  )
}
