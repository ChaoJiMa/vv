import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import BottomNav from '../components/BottomNav'
import { AppShell, EmptyState, ListError, Skeleton, Sticker } from '../components/ui'

export default function Messages() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState('message')
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
  const notiUnread = unread?.notiUnread ?? 0

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
        <EmptyState title="请先登录" actionLabel="去登录" onAction={() => navigate('/login')} emoji="🔐" />
      </AppShell>
    )
  }

  const openComment = (it) => {
    if (!it.read) readNoti.mutate(it.notificationId)
    if (it.postId) navigate(`/post/${it.postId}`)
  }

  return (
    <AppShell withNav>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>消息</h1>
          <button type="button" onClick={() => active.refetch()} style={linkBtn}>刷新</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Sticker active={tab === 'message'} onClick={() => setTab('message')}>私信</Sticker>
          <Sticker active={tab === 'comment'} color="sky" onClick={() => setTab('comment')}>
            通知{notiUnread > 0 ? ` · ${notiUnread > 99 ? '99+' : notiUnread}` : ''}
          </Sticker>
        </div>
      </header>

      <div style={{ padding: '8px 0 24px' }}>
        {isLoading && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        )}
        {!isLoading && isError && <ListError onRetry={() => active.refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            emoji={tab === 'message' ? '📭' : '🔔'}
            title={tab === 'message' ? '暂无私信' : '暂无通知'}
            description={tab === 'message' ? '去社区认识新邻居吧' : '有新动态时会在这里提醒你'}
            actionLabel={tab === 'message' ? '去首页' : undefined}
            onAction={tab === 'message' ? () => navigate('/') : undefined}
          />
        )}

        {!isLoading && tab === 'message' && messages.map((it) => {
          const unreadMsg = it.unread > 0
          return (
            <button
              key={`m-${it.peerId}`}
              type="button"
              onClick={() => navigate(`/messages/${it.peerId}`)}
              style={rowBtn}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: unreadMsg ? 'var(--color-primary)' : 'transparent' }} />
              <span style={avatar}>{it.peerAvatar ? null : (it.peerName?.[0] || '邻')}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontWeight: unreadMsg ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.peerName}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.fromMe ? '我: ' : ''}{it.content}
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
          const icon = isThank ? '🙏' : isAdopt ? '✅' : isRespond ? '🙋' : '💬'
          const title = isThank
            ? `${it.actorName} 采纳并感谢了你`
            : isAdopt
              ? `${it.actorName} 采纳了你的帮助`
              : isRespond
                ? `${it.actorName} 响应了你的帖子`
                : `${it.actorName} 回复了你`
          const showContent = !isThank && !isAdopt && !isRespond
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
              <span style={{ ...avatar, background: 'var(--color-bg-accent)', fontSize: 20 }}>{icon}</span>
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
      <BottomNav />
    </AppShell>
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
