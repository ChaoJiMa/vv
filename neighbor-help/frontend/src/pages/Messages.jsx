import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import BottomNav from '../components/BottomNav'
import { AppShell, Button, EmptyState, ListError, Skeleton } from '../components/ui'
import {
  HeartIcon, NotiAdoptIcon, NotiCommentIcon, NotiRespondIcon, NotiThankIcon, RefreshIcon, SearchIcon,
} from '../components/icons'
import { EmptyMessages } from '../components/illustrations/EmptyArts'
import { resolveAvatarUrl } from '../utils/avatar'
import { scrollToTop } from '../utils/scrollToTop'
import PageTitle from '../components/ui/PageTitle'
import './message-theme.css'

function badgeText(n) {
  if (!n || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

/** 通知标题与列表筛选共用同一份文案，不根据关键词虚构新的通知内容。 */
function notificationTitle(item) {
  if (item.notiType === 'thank') return `${item.actorName} 采纳并感谢了你`
  if (item.notiType === 'adopt') return `${item.actorName} 采纳了你的帮助`
  if (item.notiType === 'respond') return `${item.actorName} 响应了你的帖子`
  if (item.notiType === 'like') return `${item.actorName} 赞了你的帖子`
  return `${item.actorName} 回复了你`
}

/** 只检查接口已加载到当前列表的昵称、帖子与消息文字，不触发或伪装服务端全量搜索。 */
function matchesLoadedItem(item, tab, keyword) {
  const fields = tab === 'message'
    ? [item.peerName, item.postDeleted ? '原帖已删除' : (item.postTitle || '原帖已删除'), item.content ? `${item.fromMe ? '我: ' : ''}${item.content}` : '暂无消息']
    : [notificationTitle(item), item.postTitle, item.content]
  return fields.filter(Boolean).join(' ').toLowerCase().includes(keyword)
}

export default function Messages() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState('message')
  const [search, setSearch] = useState('')
  const searchInputRef = useRef(null)
  const [defaultLocked, setDefaultLocked] = useState(false)
  const visible = usePageVisible()

  const conv = useInfiniteQuery({
    queryKey: ['conversations', user?.id],
    queryFn: ({ pageParam }) => api.getConversations(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user,
  })
  const messages = conv.data?.pages.flatMap(p => p.list) ?? []

  const noti = useInfiniteQuery({
    queryKey: ['notifications', user?.id],
    queryFn: ({ pageParam }) => api.getNotifications(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user,
  })
  const notifications = noti.data?.pages.flatMap(p => p.list) ?? []

  const { data: unread } = useQuery({
    queryKey: ['unread', user?.id],
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
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] })
      qc.invalidateQueries({ queryKey: ['unread', user?.id] })
    },
  })

  const active = tab === 'message' ? conv : noti
  const isLoading = active.isLoading
  const isError = active.isError
  // 所有当前列表请求都锁定刷新入口并旋转图标，避免等待中只禁用却没有反馈。
  const isRefreshing = active.isFetching
  const list = tab === 'message' ? messages : notifications
  const keyword = search.trim().toLowerCase()
  const filtering = keyword.length > 0
  const shownList = filtering ? list.filter(item => matchesLoadedItem(item, tab, keyword)) : list

  // 私信和通知共用失败恢复规则；查询出错时停下哨兵，避免每次错误重绘再次请求失败页。
  const sentinelRef = useInfiniteScroll({
    hasNextPage: active.hasNextPage,
    isFetchingNextPage: active.isFetchingNextPage,
    fetchNextPage: active.fetchNextPage,
    // 筛选时必须由用户明确加载下一页，避免没有匹配项时悄悄下载整个会话历史。
    enabled: !!user && list.length > 0 && !filtering && !isError && !active.isFetching,
  })

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

  // 清空按钮会随关键词一起卸载；把键盘焦点交回仍然存在的搜索框。
  const clearSearch = () => {
    setSearch('')
    searchInputRef.current?.focus()
  }

  return (
    <AppShell withNav className="nh-message-page">
      {/* 参考好友页的轻量构图；这里仍是实际会话与通知，不添加好友关系或在线状态。 */}
      <header className="nh-message-header" style={{
        position: 'sticky', top: 0, zIndex: 20,
        padding: 'calc(var(--page-heading-top) + var(--safe-top)) 20px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: 'var(--page-heading-height)', marginBottom: 20 }}>
          <PageTitle>聊天</PageTitle>
          <button
            type="button"
            className="nh-message-refresh"
            aria-label="刷新"
            disabled={isRefreshing}
            aria-busy={isRefreshing || undefined}
            onClick={() => active.refetch()}
          >
            <RefreshIcon size={16} className={isRefreshing ? 'nh-spin' : undefined} />
          </button>
        </div>
        <div className="nh-message-search" role="search" aria-label="筛选当前列表">
          <SearchIcon size={23} />
          <input
            type="search"
            ref={searchInputRef}
            value={search}
            aria-label="搜索当前列表"
            aria-describedby={filtering ? 'nh-message-search-scope' : undefined}
            placeholder="搜索当前列表"
            onChange={event => setSearch(event.target.value)}
          />
          {search && <button type="button" aria-label="清空搜索" onClick={clearSearch}>清空</button>}
        </div>
        <div
          role="tablist"
          aria-label="消息分类"
          className="nh-message-tabs"
        >
          <SegTab
            id="nh-message-tab-private"
            active={tab === 'message'}
            onClick={() => setTab('message')}
            label="私信"
            badge={msgBadge}
          />
          <SegTab
            id="nh-message-tab-notice"
            active={tab === 'comment'}
            onClick={() => setTab('comment')}
            label="通知"
            badge={notiBadge}
          />
        </div>
      </header>

      <div key={tab} id="nh-message-panel" role="tabpanel" aria-labelledby={tab === 'message' ? 'nh-message-tab-private' : 'nh-message-tab-notice'} className="nh-msg-panel" style={{ padding: '4px 20px 24px' }}>
        <div className="nh-message-section">
          <h2>{tab === 'message' ? '全部会话' : '全部通知'}</h2>
          {filtering && !isLoading && <span role="status" aria-live="polite">{shownList.length} 条匹配</span>}
        </div>
        {filtering && <p className="nh-message-search-scope" id="nh-message-search-scope">仅查找当前已加载的{tab === 'message' ? '会话' : '通知'}。</p>}
        {isLoading && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        )}
        {!isLoading && isError && list.length === 0 && <ListError onRetry={() => active.refetch()} />}
        {list.length > 0 && active.isRefetchError && (
          <div role="status" style={{ textAlign: 'center', padding: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>刷新失败，已保留当前内容</p>
            <Button variant="secondary" loading={active.isFetching} onClick={() => active.refetch()}>重试刷新</Button>
          </div>
        )}
        {!isLoading && !isError && !filtering && list.length === 0 && (
          <EmptyState
            illustration={<MessageHello />}
            title={tab === 'message' ? '暂无私信' : '暂无通知'}
            description={tab === 'message' ? '去社区认识新邻居吧' : '有新动态时会在这里提醒你'}
            actionLabel={tab === 'message' ? '去首页' : undefined}
            onAction={tab === 'message' ? () => navigate('/') : undefined}
          />
        )}
        {!isLoading && filtering && shownList.length === 0 && (!isError || list.length > 0) && (
          <EmptyState
            illustration={<SearchIcon size={44} />}
            title="当前列表暂无匹配"
            description={active.hasNextPage ? '可加载更多内容后继续查找，或换个关键词' : '试试其他关键词，或清空搜索查看全部'}
            actionLabel="清空搜索"
            onAction={clearSearch}
          />
        )}

        {!isLoading && tab === 'message' && shownList.map((it) => {
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
              className={`nh-conversation-card${unreadMsg ? ' is-unread' : ''}`}
              aria-label={unreadMsg ? `未读私信，${it.peerName}，${postLabel}，${preview}，${formatTime(it.createdAt)}` : undefined}
              onClick={() => navigate(`/messages/${it.conversationId}`)}
              style={rowBtn}
            >
              <span className="nh-conversation-avatar" style={avatar} aria-hidden>
                <span className="nh-conversation-avatar-face">
                  {peerAvatarSrc
                    ? <img src={peerAvatarSrc} alt="" />
                    : (it.peerName?.[0] || '邻')}
                </span>
                {unreadMsg && <span className="nh-conversation-unread" />}
              </span>
              <span className="nh-conversation-copy">
                <span className="nh-conversation-topline">
                  <span className="nh-conversation-name" style={{ fontWeight: unreadMsg ? 750 : 650 }}>{it.peerName}</span>
                  <span className="nh-conversation-time">{formatTime(it.createdAt)}</span>
                </span>
                <span className="nh-conversation-preview">
                  {postLabel} · {preview}
                </span>
              </span>
            </button>
          )
        })}

        {!isLoading && tab === 'comment' && shownList.map((it) => {
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
          const title = notificationTitle(it)
          const showContent = !isThank && !isAdopt && !isRespond && !isLike
          return (
            <button
              key={`n-${it.notificationId}`}
              type="button"
              className={`nh-conversation-card nh-notification-card${it.read ? '' : ' is-unread'}`}
              aria-label={!it.read ? `未读通知，${title}，${showContent ? `${it.content}，` : ''}${it.postTitle}，${formatTime(it.createdAt)}` : undefined}
              onClick={() => openComment(it)}
              style={rowBtn}
            >
              <span className="nh-conversation-avatar nh-notification-avatar" style={avatar} aria-hidden>
                <span className="nh-conversation-avatar-face">
                  {isLike
                    ? <HeartIcon size={22} filled />
                    : <NotiIcon size={22} />}
                </span>
                {!it.read && <span className="nh-conversation-unread" />}
              </span>
              <span className="nh-conversation-copy">
                <span className="nh-conversation-topline">
                  <span className="nh-conversation-name nh-notification-name" style={{ fontWeight: it.read ? 650 : 750 }}>{title}</span>
                  <span className="nh-conversation-time">{formatTime(it.createdAt)}</span>
                </span>
                <span className="nh-conversation-preview">
                  {showContent
                    ? `${it.content.slice(0, 20)}${it.content.length > 20 ? '…' : ''} · ${it.postTitle}`
                    : it.postTitle}
                </span>
              </span>
            </button>
          )
        })}

        {!isLoading && (list.length > 0 || (filtering && active.hasNextPage)) && (
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {active.isFetchNextPageError ? (
              <div role="status">
                <p>加载更多失败，已有内容已保留</p>
                <Button variant="secondary" loading={active.isFetchingNextPage} disabled={active.isFetching && !active.isFetchingNextPage} onClick={() => active.fetchNextPage()}>重试加载更多</Button>
              </div>
            ) : filtering && active.hasNextPage ? (
              <div>
                <Button
                  variant="secondary"
                  loading={active.isFetchingNextPage}
                  disabled={active.isFetching && !active.isFetchingNextPage}
                  onClick={() => active.fetchNextPage()}
                  style={{ borderRadius: 999 }}
                >加载更多后继续查找</Button>
                {active.isFetchingNextPage && <p role="status">加载中…</p>}
              </div>
            ) : active.isFetchingNextPage ? '加载中…' : !active.hasNextPage ? '没有更多了' : ''}
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
        }
      `}</style>
      <BottomNav />
    </AppShell>
  )
}

/** 缺省插画仅由代码绘制轻量问候气泡，不替换任何真人头像或生成虚构会话。 */
function MessageHello() {
  return <div className="nh-message-hello" aria-hidden><span>hi</span><span>hi</span><span>hi</span></div>
}

function SegTab({ active, onClick, label, badge, id }) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-controls="nh-message-panel"
      aria-selected={active}
      onClick={onClick}
      className="nh-message-tab"
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
            color: 'var(--color-on-danger)',
            transition: 'background 180ms ease, color 180ms ease',
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

const rowBtn = {
  display: 'flex', alignItems: 'center', width: '100%',
  color: 'var(--color-text)', cursor: 'pointer',
}
const avatar = {
  flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 20, fontWeight: 700,
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
