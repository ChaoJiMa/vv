import { useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom'
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

/** 固定五项导航：沿用原屏的窄幅半透胶囊，保留路由、鉴权和发布分类流程。 */
export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname, search, hash, key, state } = useLocation()
  const navigationType = useNavigationType()
  const { user } = useAuth()
  const userId = user?.id
  const qc = useQueryClient()
  const visible = usePageVisible()
  const [typePickOpen, setTypePickOpen] = useState(false)

  const { data: unread } = useQuery({
    queryKey: ['unread', user?.id],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: pollInterval(visible, 20000),
  })
  const unreadTotal = unread?.total ?? 0

  // 只有目标页面已提交时才回顶；被草稿 blocker 拦下时不能先改变编辑器位置。
  // POP 是浏览器返回，需留给页面自己的位置恢复，不能重复应用旧历史中的标记。
  const resetAfterNavigation = state?.navScrollReset === true
  useLayoutEffect(() => {
    if (navigationType !== 'POP' && resetAfterNavigation) scrollToTop()
  }, [key, navigationType, resetAfterNavigation])

  // 空闲时预取其它 Tab 数据与路由包，减少首次切换时的骨架闪屏
  useEffect(() => {
    if (!visible) return undefined
    const run = () => {
      import('../pages/Discover').catch(() => {})
      import('../pages/Messages').catch(() => {})
      import('../pages/Profile').catch(() => {})
      // 预取只填空缓存，不重刷已经浏览的多页；真实页面负责新鲜度与错误重试。
      // 即使共享查询正处于首屏请求中，也提供完整翻页规则，避免改写为缺失规则的配置。
      const warmInfinite = (queryKey, queryFn) => {
        if (qc.getQueryData(queryKey) !== undefined) return
        qc.prefetchInfiniteQuery({
          queryKey,
          queryFn,
          initialPageParam: 1,
          getNextPageParam: lastPage => lastPage.hasMore ? lastPage.page + 1 : undefined,
        })
      }
      warmInfinite(['posts', '', '', userId], ({ pageParam }) => api.getPosts('', pageParam, ''))
      if (userId) {
        warmInfinite(['conversations', userId], ({ pageParam }) => api.getConversations(pageParam))
        warmInfinite(['notifications', userId], ({ pageParam }) => api.getNotifications(pageParam))
        warmInfinite(['myPosts', '', userId], ({ pageParam }) => api.getMyPosts(pageParam, ''))
        const statsKey = ['myStats', userId]
        if (qc.getQueryData(statsKey) === undefined) qc.prefetchQuery({ queryKey: statsKey, queryFn: () => api.getMyStats() })
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
  }, [qc, userId, visible])

  const go = (path, requireAuth) => {
    if (requireAuth && !user) {
      toast.info('登录后可用')
      navigate('/login', { state: { from: { pathname: path } } })
      return
    }
    if (`${pathname}${search}${hash}` === path) {
      scrollToTop()
      return
    }
    navigate(path, { state: { navScrollReset: true } })
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
      className="nh-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        maxWidth: 480,
        margin: '0 auto',
        // 页面与浮动入口使用同一占位；透明留白可穿透点击，只有胶囊接收指针。
        height: 'var(--nav-floating-footprint)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        background: 'transparent',
        pointerEvents: 'none',
      }}
    >
      <div
        className="nh-nav-pill"
        style={{
          display: 'flex', alignItems: 'stretch', width: '66.6667%', maxWidth: 320, minWidth: 240,
          height: 'var(--nav-height)', flexShrink: 0, pointerEvents: 'auto',
          margin: '0 auto',
          padding: '8px 6px', borderRadius: 999, boxSizing: 'border-box',
          border: 'none',
          boxShadow: '0 6px 24px rgba(36, 35, 38, 0.04)',
        }}
      >
        {left.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
        <NavItem
          item={{ key: 'create', label: '发布', path: '/create', Icon: NavAddIcon }}
          pathname={pathname}
          onActivate={() => {
            if (!user) {
              toast.info('登录后可用')
              navigate('/login', { state: { from: { pathname: '/create' } } })
              return
            }
            setTypePickOpen(true)
          }}
        />
        {right.map(it => <NavItem key={it.key} item={it} pathname={pathname} go={go} />)}
      </div>
      <TypePickSheet
        open={typePickOpen}
        onClose={() => setTypePickOpen(false)}
        onPick={(type) => {
          setTypePickOpen(false)
          navigate('/create', {
            state: { type, navScrollReset: pathname !== '/create' },
            // 已在发布页时替换当前历史，避免连点 + 堆多层 /create
            replace: pathname === '/create',
          })
        }}
      />
      <style>{`
        .nh-bottom-nav {
          --nh-nav-inactive-icon: #788397;
          --nh-nav-inactive-label: #5d6676;
          padding: 8px 0 var(--nav-floating-bottom);
        }
        .nh-bottom-nav .nh-nav-pill {
          background: var(--color-surface);
        }
        @supports (backdrop-filter: blur(18px)) or (-webkit-backdrop-filter: blur(18px)) {
          .nh-bottom-nav .nh-nav-pill {
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(18px);
            -webkit-backdrop-filter: blur(18px);
          }
          [data-theme="dark"] .nh-bottom-nav .nh-nav-pill {
            background: rgba(42, 38, 48, 0.94);
          }
        }
        [data-theme="dark"] .nh-bottom-nav {
          --nh-nav-inactive-icon: #aab3c6;
          --nh-nav-inactive-label: #aab3c6;
        }
        .nh-bottom-nav .nh-nav-item {
          transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-bottom-nav .nh-nav-item:active {
          transform: scale(0.96);
        }
        .nh-bottom-nav .nh-nav-icon {
          display: inline-flex;
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-bottom-nav .nh-nav-item { transition: none !important; }
          .nh-bottom-nav .nh-nav-item:active { transform: none; }
        }
      `}</style>
    </nav>
  )
}

/** 统一五项入口的图标与文字；发布只替换激活动作，继续使用原鉴权与分类弹层。 */
function NavItem({ item, pathname, go, onActivate }) {
  const selected = pathname === item.path
  const Icon = item.Icon
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      onClick={onActivate ?? (() => go(item.path, item.auth))}
      className={`nh-nav-item${selected ? ' nh-nav-item-selected' : ''}`}
      style={{
        flex: 1,
        minWidth: 44,
        minHeight: 44,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        // 图标与小字分别保留对比度，选中态另用实心形状，不靠颜色独自传达状态。
        color: selected ? 'var(--color-text)' : 'var(--nh-nav-inactive-label)',
        padding: '6px 0',
      }}
    >
      <Badge color="error" badgeContent={item.badge || 0} max={99}>
        <span className="nh-nav-icon" style={{ color: selected ? 'var(--color-text)' : 'var(--nh-nav-inactive-icon)' }}>
          <Icon size={26} filled={selected} />
        </span>
      </Badge>
      <span
        className="nh-nav-label"
        style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}
      >
        {item.label}
      </span>
    </button>
  )
}
