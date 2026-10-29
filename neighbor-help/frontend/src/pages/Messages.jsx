import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import BottomNav from '../components/BottomNav'
import { AppShell, EmptyState, ListError, Skeleton } from '../components/ui'
import {
  HeartIcon, NotiAdoptIcon, NotiCommentIcon, NotiRespondIcon, NotiThankIcon, RefreshIcon,
} from '../components/icons'
import { EmptyMessages, EmptyNotices } from '../components/illustrations/EmptyArts'
import { resolveAvatarUrl } from '../utils/avatar'
import { scrollToTop } from '../utils/scrollToTop'

function badgeText(n) {
  if (!n || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export default function Messages() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState('message')
  const [defaultLocked, setDefaultLocked] = useState(false)
  const visible = usePageVisible()

  const conv = useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: ({ pageParam }) => api.getConversations(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user,
  })
  const messages = conv.data?.pages.flatMap(p => p.list) ?? []

  const noti = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.getNotifications(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user,
  })
  const notifications = noti.data?.pages.flatMap(p => p.list) ?? []

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.getUnread(),
    enabled: !!user,
    refetchInterval: pollInterval(visible, 15000),
  })
  const messageUnread = unread?.messageUnread ?? 0
  const notiUnread = unread?.notiUnread ?? 0
  const msgBadge = badgeText(messageUnread)
  const notiBadge = badgeText(notiUnread)

  // 首次拿到 unread 后锁定默认 Tab（一次性）；之后只靠手动 setTab
  /* eslint-disable react-hooks/set-state-in-effect -- 有意的一次性初始化，避免轮询改写 Tab */
  useEffect(() => {
    if (defaultLocked || unread == null) return
    const next = messageUnread > 0 ? 'message' : (notiUnread > 0 ? 'comment' : 'message')
    setTab(next)
    setDefaultLocked(true)
  }, [defaultLocked, unread, messageUnread, notiUnread])
  /* eslint-enable react-hooks/set-state-in-effect */

  useLayoutEffect(() => {
    if (!defaultLocked) return
    scrollToTop()
  }, [tab, defaultLocked])

  const readNoti = useMutation({
    mutationFn: (id) => api.readNotification(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread'] })
    },
  })

  const active = tab === 'message' ? conv : noti
  const isLoading = active.isLoading
  const isError = active.isError
  const isRefreshing = active.isRefetching
  const list = tab === 'message' ? messages : notifications

  const sentinelRef = useRef(null)
  const observe = useCallback((node) => {
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && active.hasNextPage && !active.isFetchingNextPage) active.fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(node)
    return io
  }, [active])
  useEffect(() => {
    const io = observe(sentinelRef.current)
    return () => io?.disconnect()
  }, [observe])

  if (!user) {
    return (
      <AppShell>
        <EmptyState title="请先登录" actionLabel="去登录" onAction={() => navigate('/login')} illustration={<EmptyMessages />} />
      </AppShell>
    )
  }

  const openComment = (it) => {
    if (!it.read) readNoti.mutate(it.notificationId)
    if (it.postId) navigate(`/note/${it.postId}`)
  }

  return (
    <AppShell withNav>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
        padding: 'calc(12px + var(--safe-top)) 16px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>消息</h1>
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => active.refetch()}
            style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: isRefreshing ? 0.7 : 1 }}
          >
            <RefreshIcon size={16} className={isRefreshing ? 'nh-spin' : undefined} />
            刷新
          </button>
        </div>
        <div
          role="tablist"
          aria-label="消息分类"
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 4,
            padding: 4,
            borderRadius: 12,
            background: 'var(--color-bg-accent)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span
            aria-hidden
            className="nh-msg-seg-thumb"
            style={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: 4,
              width: 'calc(50% - 4px)',
              borderRadius: 10,
              background: 'var(--color-surface)',
              boxShadow: '0 1px 3px color-mix(in srgb, var(--color-text) 12%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-primary) 14%, transparent)',
              transform: tab === 'comment' ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
              transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <SegTab
            active={tab === 'message'}
            onClick={() => setTab('message')}
            label="私信"
            badge={msgBadge}
          />
          <SegTab
            active={tab === 'comment'}
            onClick={() => setTab('comment')}
            label="通知"
            badge={notiBadge}
          />
        </div>
      </header>

      <div key={tab} className="nh-msg-panel" style={{ padding: '8px 0 24px' }}>
        {isLoading && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        )}
        {!isLoading && isError && <ListError onRetry={() => active.refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            illustration={tab === 'message' ? <EmptyMessages /> : <EmptyNotices />}
            title={tab === 'message' ? '暂无私信' : '暂无通知'}
            description={tab === 'message' ? '去社区认识新邻居吧' : '有新动态时会在这里提醒你'}
            actionLabel={tab === 'message' ? '去首页' : undefined}
            onAction={tab === 'message' ? () => navigate('/') : undefined}
          />
        )}

        {!isLoading && tab === 'message' && messages.map((it) => {
          const unreadMsg = it.unread > 0
          const postLabel = it.postDeleted ? '原帖已删除' : (it.postTitle || '原帖已删除')
          const preview = it.content
            ? `${it.fromMe ? '我: ' : ''}${it.content}`
            : '暂无消息'
          const peerAvatarSrc = resolveAvatarUrl(it.peerAvatar)
          return (
            <button
              key={`m-${it.conversationId}`}
              type="button"
              onClick={() => navigate(`/messages/${it.conversationId}`)}
              style={rowBtn}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: unreadMsg ? 'var(--color-primary)' : 'transparent' }} />
              <span style={{ ...avatar, overflow: 'hidden' }}>
                {peerAvatarSrc
                  ? <img src={peerAvatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (it.peerName?.[0] || '邻')}
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontWeight: unreadMsg ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.peerName}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {postLabel} · {preview}
                </span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>{formatTime(it.createdAt)}</span>
            </button>
          )
        })}

        {!isLoading && tab === 'comment' && notifications.map((it) => {
          const isThank = it.notiType === 'thank'
          const isAdopt = it.notiType === 'adopt'
          const isRespond = it.notiType === 'respond'
          const isLike = it.notiType === 'like'
          const NotiIcon = isThank
            ? NotiThankIcon
            : isAdopt
              ? NotiAdoptIcon
              : isRespond
                ? NotiRespondIcon
                : isLike
                  ? null
                  : NotiCommentIcon
          const title = isThank
            ? `${it.actorName} 采纳并感谢了你`
            : isAdopt
              ? `${it.actorName} 采纳了你的帮助`
              : isRespond
                ? `${it.actorName} 响应了你的帖子`
                : isLike
                  ? `${it.actorName} 赞了你的帖子`
                  : `${it.actorName} 回复了你`
          const showContent = !isThank && !isAdopt && !isRespond && !isLike
          return (
            <button
              key={`n-${it.notificationId}`}
              type="button"
              onClick={() => openComment(it)}
              style={{
                ...rowBtn,
                background: it.read ? 'transparent' : 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: it.read ? 'transparent' : 'var(--color-primary)' }} />
              <span style={{ ...avatar, background: 'var(--color-bg-accent)', color: 'var(--color-primary)' }}>
                {isLike
                  ? <HeartIcon size={22} filled />
                  : <NotiIcon size={22} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontWeight: it.read ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {showContent
                    ? `${it.content.slice(0, 20)}${it.content.length > 20 ? '…' : ''} · ${it.postTitle}`
                    : it.postTitle}
                </span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>{formatTime(it.createdAt)}</span>
            </button>
          )
        })}

        {!isLoading && list.length > 0 && (
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {active.isFetchingNextPage ? '加载中…' : !active.hasNextPage ? '没有更多了' : ''}
          </div>
        )}
      </div>
      <style>{`
        .nh-msg-panel {
          animation: nhMsgPanelIn 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes nhMsgPanelIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-msg-panel { animation: none !important; }
          .nh-msg-seg-thumb { transition: none !important; }
        }
      `}</style>
      <BottomNav />
    </AppShell>
  )
}

function SegTab({ active, onClick, label, badge }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        position: 'relative',
        zIndex: 1,
        border: 'none',
        borderRadius: 10,
        minHeight: 40,
        padding: '0 12px',
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: active ? 700 : 600,
        background: 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
        transition: 'color 180ms ease, font-weight 180ms ease',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {label}
      {badge ? (
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 9,
            fontSize: 11,
            fontWeight: 700,
            lineHeight: '18px',
            textAlign: 'center',
            background: 'var(--color-danger)',
            color: 'var(--color-on-primary)',
            transition: 'background 180ms ease, color 180ms ease',
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

const linkBtn = {
  border: 'none', background: 'transparent', color: 'var(--color-text-muted)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36,
}
const rowBtn = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
  padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--color-border)',
  background: 'transparent', color: 'var(--color-text)', cursor: 'pointer',
}
const avatar = {
  width: 44, height: 44, borderRadius: 22, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--color-primary)', color: 'var(--color-on-primary)', fontSize: 18, fontWeight: 700,
}

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
