import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { captureSession, isSessionCurrent, assertSessionCurrent } from '../session'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import { useChatScroll } from '../hooks/useChatScroll'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import { toast } from '../toast'
import { AppShell, Button, EmptyState } from '../components/ui'
import { BackIcon, SendIcon } from '../components/icons'
import { EmptyMessages } from '../components/illustrations/EmptyArts'
import { resolveAvatarUrl } from '../utils/avatar'
import { displayInitial } from '../utils/displayName'
import './message-theme.css'

export default function Chat() {
  const { conversationId } = useParams()
  const { user } = useAuth()
  // 同一路由切换会话/账号时，清掉输入、失败重送和阅读位置，避免串到下一个会话。
  return <ChatThread key={`${user?.id || 'guest'}:${conversationId}`} conversationId={conversationId} user={user} />
}

/** 会话页：暂时失败保留已有消息；只有后端明确拒绝会话时展示失效引导。 */
function ChatThread({ conversationId, user }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [keyboardPad, setKeyboardPad] = useState(0)
  const [failedDraft, setFailedDraft] = useState(null)
  const visible = usePageVisible()

  const {
    data, isLoading, isError, error, refetch, isFetching, isFetchNextPageError,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['thread', conversationId, user?.id],
    queryFn: ({ pageParam }) => api.getThread(conversationId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user && !!conversationId,
    refetchInterval: pollInterval(visible, 8000),
  })
  // 轮询与历史分页使用 offset，交界处可能重复；按 id 去重，保持气泡及阅读锚点稳定。
  const list = useMemo(() => {
    const seen = new Set()
    return data ? [...data.pages].reverse().flatMap(p => p.list).filter(message => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    }) : []
  }, [data])
  const meta = data?.pages?.[0]
  const peer = meta?.peer
  const postTitle = meta?.postTitle
  const postId = meta?.postId
  const postDeleted = !!meta?.postDeleted
  // /messages/thread 仅用 3002 表示无效/无权访问的会话，网络和 5xx 仍可重试。
  const invalidConversation = isError && error?.code === 3002
  const hasMessages = list.length > 0
  const { listRef, bottomRef, hasNewMessages, jumpToLatest, followNextMessage, loadOlder } = useChatScroll({
    messages: list,
    pageCount: data?.pages.length ?? 0,
    userId: user?.id,
    fetchNextPage,
  })
  const topRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: loadOlder,
    rootMargin: '100px',
    enabled: hasMessages && !isError && !isFetching,
  })

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const sync = () => {
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboardPad(gap)
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  const sendMutation = useMutation({
    mutationFn: ({ content, session }) => {
      assertSessionCurrent(session)
      return api.sendMessage(conversationId, content, { silentError: true })
    },
    onMutate: async ({ content, session }) => {
      const queryKey = ['thread', conversationId, user?.id]
      await qc.cancelQueries({ queryKey })
      assertSessionCurrent(session)
      const prev = qc.getQueryData(queryKey)
      followNextMessage()
      const tempId = `temp-${Date.now()}`
      const optimistic = {
        id: tempId,
        sender_id: user.id,
        receiver_id: peer?.id,
        content,
        created_at: Date.now(),
        pending: true,
      }
      qc.setQueryData(queryKey, (old) => {
        if (!old?.pages?.length) {
          return {
            // 保留当前 peer，避免首条乐观消息把顶栏头像/昵称冲掉
            pages: [{ list: [optimistic], peer: peer || null, page: 1, hasMore: false }],
            pageParams: [1],
          }
        }
        const pages = old.pages.map((p, i) => (
          i === 0 ? { ...p, list: [...(p.list || []), optimistic] } : p
        ))
        return { ...old, pages }
      })
      // 取消查询期间或点击重送前，用户可能已经开始写下一条；只清除本次真正发送的输入。
      setText(current => current.trim() === content ? '' : current)
      setFailedDraft(null)
      return { prev, content, session, queryKey, tempId, optimisticData: qc.getQueryData(queryKey) }
    },
    onError: (e, _content, ctx) => {
      if (!isSessionCurrent(ctx?.session)) return
      const current = qc.getQueryData(ctx.queryKey)
      if (current && current !== ctx.optimisticData) {
        // 轮询/历史分页可能在发送期间取得有效新消息，不能用发送前快照覆盖它们。
        // 若轮询已经替换了临时气泡，不再改写缓存，也保留它的错误/成功状态。
        if (current.pages.some(page => page.list.some(message => message.id === ctx.tempId))) {
          qc.setQueryData(ctx.queryKey, {
            ...current,
            pages: current.pages.map(page => ({ ...page, list: page.list.filter(message => message.id !== ctx.tempId) })),
          })
        }
      } else if (ctx.prev !== undefined) qc.setQueryData(ctx.queryKey, ctx.prev)
      else qc.removeQueries({ queryKey: ctx.queryKey, exact: true })
      if (ctx?.content) {
        setText(current => current || ctx.content)
        setFailedDraft(ctx.content)
      }
      toast.error(e.message || '发送失败')
    },
    onSuccess: (_data, _content, ctx) => {
      if (!isSessionCurrent(ctx?.session)) return
      setFailedDraft(null)
      qc.invalidateQueries({ queryKey: ['thread', conversationId, user?.id] })
      qc.invalidateQueries({ queryKey: ['conversations', user?.id] })
      qc.invalidateQueries({ queryKey: ['unread', user?.id] })
    },
  })

  const handleSend = () => {
    const t = text.trim()
    if (!t || sendMutation.isPending) return
    sendMutation.mutate({ content: t, session: captureSession() })
  }

  const handleResend = () => {
    if (!failedDraft || sendMutation.isPending) return
    sendMutation.mutate({ content: failedDraft, session: captureSession() })
  }

  const openPost = () => {
    if (postDeleted || !postId) {
      toast.info('原帖已删除')
      return
    }
    navigate(`/note/${postId}`)
  }

  if (!user) {
    return (
      <AppShell>
        <EmptyState title="请先登录" actionLabel="去登录" onAction={() => navigate('/login')} illustration={<EmptyMessages />} />
      </AppShell>
    )
  }

  const peerAvatarSrc = resolveAvatarUrl(peer?.avatar)
  const myAvatarSrc = resolveAvatarUrl(user.avatar)

  return (
    // 历史页由 useChatScroll 补偿锚点，关闭浏览器自身锚定，避免同一高度变化补偿两次。
    <AppShell className="nh-chat-page" style={{ paddingBottom: `calc(var(--nav-height-safe) + ${keyboardPad}px)`, overflowAnchor: 'none' }}>
      {/* 顶栏与来源仍使用原导航，真人头像原样显示；浅色材质不引入好友或在线状态。 */}
      <header className="nh-page-chrome-top" style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 'calc(10px + var(--safe-top)) 12px 12px', minHeight: 52,
        borderBottom: '1px solid var(--color-border)',
      }}>
        <button type="button" aria-label="返回" onClick={() => navigate(-1)} style={iconBtn}>
          <BackIcon size={22} />
        </button>
        <span className="nh-chat-avatar" aria-hidden style={{
          width: 40, height: 40, borderRadius: 15, flexShrink: 0, overflow: 'hidden',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700,
        }}>
          {peerAvatarSrc
            ? <img src={peerAvatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : displayInitial(peer)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 750, fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {peer?.nickname?.trim() || '邻居'}
          </div>
          <button
            type="button"
            className="nh-chat-source"
            onClick={openPost}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              border: '1px solid var(--color-border)', borderRadius: 12,
              padding: '5px 9px', marginTop: 5, cursor: 'pointer',
              fontSize: 12, color: 'var(--color-text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {postTitle || (isLoading ? '…' : isError ? '消息暂未加载' : '原帖已删除')}
          </button>
        </div>
      </header>

      {isLoading && <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>加载中…</div>}
      {!isLoading && invalidConversation && (
        <EmptyState
          title="会话无效或已失效"
          description="旧私信链接已不可用，请从消息列表或帖子重新进入"
          actionLabel="回消息"
          onAction={() => navigate('/messages')}
          illustration={<EmptyMessages />}
        />
      )}
      {!isLoading && isError && !invalidConversation && !hasMessages && (
        <EmptyState
          title="暂时无法加载消息"
          description="请检查网络后重试，输入内容会保留"
          actionLabel={isFetching ? '重试中…' : '重试'}
          actionLoading={isFetching}
          onAction={() => { if (!isFetching) refetch() }}
          illustration={<EmptyMessages />}
        />
      )}
      {isError && !invalidConversation && hasMessages && !isFetchNextPageError && (
        <div role="status" style={{ padding: '12px 16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>刷新失败，已保留当前消息</p>
          <Button variant="secondary" loading={isFetching} onClick={() => refetch()}>重试刷新</Button>
        </div>
      )}
      {!isLoading && !isError && list.length === 0 && (
        <EmptyState title="还没有消息" description="打个招呼吧" illustration={<EmptyMessages />} />
      )}

      {!invalidConversation && (
      <div ref={listRef} style={{ padding: '12px 16px 24px' }}>
        {list.length > 0 && (
          <div ref={topRef} style={{ textAlign: 'center', padding: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {isFetchNextPageError ? (
              <div role="status">
                <p style={{ margin: '0 0 8px' }}>更早消息加载失败，当前消息已保留</p>
                <Button variant="secondary" loading={isFetchingNextPage} disabled={isFetching && !isFetchingNextPage} onClick={loadOlder}>重试加载更早消息</Button>
              </div>
            ) : isFetchingNextPage ? '加载中…' : !hasNextPage ? '没有更早的消息了' : ''}
          </div>
        )}
        {list.map(m => {
          const mine = m.sender_id === user.id
          const src = mine ? myAvatarSrc : peerAvatarSrc
          const initial = mine
            ? displayInitial(user, '我')
            : displayInitial(peer)
          return (
            <div
              key={m.id}
              data-message-id={m.id}
              style={{
                display: 'flex',
                flexDirection: mine ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <span className={`nh-chat-avatar${mine ? ' is-mine' : ''}`} style={bubbleAvatar} aria-hidden>
                {src
                  ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initial}
              </span>
              <div className={`nh-chat-bubble${mine ? ' is-mine' : ''}`} style={{
                position: 'relative',
                maxWidth: '68%',
                padding: '10px 14px',
                // 靠头像一侧圆角略小，形成轻指向，不另加硬三角
                borderRadius: mine ? '21px 21px 7px 21px' : '21px 21px 21px 7px',
                backgroundColor: mine ? 'var(--color-category-lost-bg)' : 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                opacity: m.pending ? 0.7 : 1,
                wordBreak: 'break-word',
                fontSize: 14,
                lineHeight: 1.55,
              }}>
                {m.content}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} style={{ scrollMarginBottom: `calc(88px + ${keyboardPad}px + var(--safe-bottom))` }} />
      </div>
      )}

      {!invalidConversation && (failedDraft || hasNewMessages) ? (
        <div style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: `calc(64px + ${keyboardPad}px + var(--safe-bottom))`,
          width: '100%', maxWidth: 480, padding: '0 16px', boxSizing: 'border-box', zIndex: 30,
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
        }}>
          {hasNewMessages && (
            <Button onClick={() => jumpToLatest()} style={{ borderRadius: 999, minHeight: 44 }}>有新消息，点击查看</Button>
          )}
          {failedDraft && (
          <button
            type="button"
            onClick={handleResend}
            style={{
              width: '100%', border: '1px solid var(--color-border)', borderRadius: 16, padding: '10px 12px',
              background: 'var(--color-bg-accent)', color: 'var(--color-danger)',
              boxShadow: 'var(--shadow-card)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            发送失败，点此重送
          </button>
          )}
        </div>
      ) : null}

      {!invalidConversation && (
      <div className="nh-page-chrome-bottom" style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: keyboardPad,
        width: '100%', maxWidth: 480,
        display: 'flex', gap: 8, alignItems: 'center',
        padding: '10px 12px calc(10px + var(--safe-bottom))',
        // 固定输入条由全局 chrome 类对齐底部柔光，白色材质只属于输入框。
        // 键盘补偿会将输入条抬离视口底部，此时只用基础底，避免错误重复采样底角柔光。
        backgroundImage: keyboardPad > 0 ? 'none' : undefined,
        borderRadius: '24px 24px 0 0',
        borderTop: '1px solid var(--color-border)',
        boxShadow: '0 -4px 18px var(--color-border)',
        boxSizing: 'border-box',
        zIndex: 40,
      }}>
        <input
          value={text}
          className="nh-chat-input"
          aria-label="私信内容"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // 中文候选确认也会触发 Enter；组合输入完成前不能把尚未确认的文字发出去。
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="发条私信..."
          style={{
            flex: 1, minWidth: 0, minHeight: 44, borderRadius: 18, border: '1.5px solid var(--color-border)',
            background: 'var(--color-surface)', color: 'var(--color-text)', padding: '0 14px',
            fontSize: 16,
          }}
        />
        <Button
          type="button"
          onClick={handleSend}
          loading={sendMutation.isPending}
          disabled={!text.trim()}
          style={{ borderRadius: 999, minWidth: 72 }}
        >
          <SendIcon size={16} /> 发送
        </Button>
      </div>
      )}
    </AppShell>
  )
}

const bubbleAvatar = {
  width: 36, height: 36, borderRadius: 13, flexShrink: 0, overflow: 'hidden',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 13, fontWeight: 700,
}

const iconBtn = {
  width: 44, height: 44, border: '1px solid var(--color-border)', borderRadius: 17,
  background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 var(--color-material-highlight)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
