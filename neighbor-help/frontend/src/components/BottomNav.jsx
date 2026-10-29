import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Badge from '@mui/material/Badge'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import { toast } from '../toast'
import TypePickSheet from './TypePickSheet'
import {
  NavHomeIcon, NavDiscoverIcon, NavMessageIcon, NavMeIcon, NavAddIcon,
} from './icons'
import { scrollToTop } from '../utils/scrollToTop'

export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const visible = usePageVisible()
  const [typePickOpen, setTypePickOpen] = useState(false)

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: pollInterval(visible, 20000),
  })
  const unreadTotal = unread?.total ?? 0

  // 空闲时预取其它 Tab 数据与路由包，减少首次切换时的骨架闪屏
  useEffect(() => {
    if (!visible) return undefined
    const run = () => {
      import('../pages/Discover')
      import('../pages/Messages')
      import('../pages/Profile')
      qc.prefetchInfiniteQuery({
        queryKey: ['posts', '', ''],
        queryFn: ({ pageParam }) => api.getPosts('', pageParam, ''),
        initialPageParam: 1,
      })
      if (user) {
        qc.prefetchInfiniteQuery({
          queryKey: ['conversations'],
          queryFn: ({ pageParam }) => api.getConversations(pageParam),
          initialPageParam: 1,
        })
        qc.prefetchInfiniteQuery({
          queryKey: ['notifications'],
          queryFn: ({ pageParam }) => api.getNotifications(pageParam),
          initialPageParam: 1,
        })
        qc.prefetchInfiniteQuery({
          queryKey: ['myPosts', ''],
          queryFn: ({ pageParam }) => api.getMyPosts(pageParam, ''),
          initialPageParam: 1,
        })
        qc.prefetchQuery({ queryKey: ['myStats'], queryFn: () => api.getMyStats() })
      }
    }
    let idleId
    let timerId
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(run, { timeout: 2500 })
    } else {
      timerId = setTimeout(run, 600)
    }
    return () => {
      if (idleId != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId)
      if (timerId != null) clearTimeout(timerId)
    }
  }, [qc, user, visible])

  const go = (path, requireAuth) => {
    if (requireAuth && !user) {
      toast.info('登录后可用')
      navigate('/login', { state: { from: { pathname: path } } })
      return
    }
    navigate(path)
    scrollToTop()
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
        // 内容区保持 --nav-height，底部再加安全区；实色底跟主题走（全宽采样见 ChromePad）
        height: 'var(--nav-height-safe)',
        paddingBottom: 'var(--safe-bottom)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--chrome-color, var(--color-bg))',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {left.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <button
          type="button"
          aria-label="发布"
          onClick={() => {
            if (!user) {
              toast.info('登录后可用')
              navigate('/login', { state: { from: { pathname: '/create' } } })
              return
            }
            setTypePickOpen(true)
          }}
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
            transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease',
          }}
        >
          <NavAddIcon size={28} />
        </button>
      </div>
      {right.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
      <TypePickSheet
        open={typePickOpen}
        onClose={() => setTypePickOpen(false)}
        onPick={(type) => {
          setTypePickOpen(false)
          navigate('/create', {
            state: { type },
            // 已在发布页时替换当前历史，避免连点 + 堆多层 /create
            replace: pathname === '/create',
          })
        }}
      />
      <style>{`
        .nh-nav-fab:active { transform: scale(0.92); }
        .nh-nav-item {
          transition: color 200ms ease;
        }
        .nh-nav-item .nh-nav-icon {
          display: inline-flex;
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-nav-item-selected .nh-nav-icon {
          animation: nhNavPop 260ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-nav-item .nh-nav-label {
          transition: font-weight 180ms ease, opacity 180ms ease, transform 200ms ease;
        }
        .nh-nav-item-selected .nh-nav-label {
          transform: translateY(-0.5px);
        }
        @keyframes nhNavPop {
          0% { transform: scale(1); }
          45% { transform: scale(1.14); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-nav-fab,
          .nh-nav-item,
          .nh-nav-item .nh-nav-icon,
          .nh-nav-item .nh-nav-label { transition: none !important; }
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
      className={`nh-nav-item${selected ? ' nh-nav-item-selected' : ''}`}
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
        <span className="nh-nav-icon">
          <Icon size={24} filled={selected} />
        </span>
      </Badge>
      <span
        className="nh-nav-label"
        style={{ fontSize: 10.5, fontWeight: selected ? 700 : 400, lineHeight: 1 }}
      >
        {item.label}
      </span>
    </button>
  )
}
