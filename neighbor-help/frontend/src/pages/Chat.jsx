import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { usePageVisible, pollInterval } from '../hooks/usePageVisible'
import { toast } from '../toast'
import { AppShell, Button, EmptyState, ListError } from '../components/ui'
import { BackIcon, SendIcon } from '../components/icons'
import { EmptyMessages } from '../components/illustrations/EmptyArts'

export default function Chat() {
  const { peerId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const fromPostId = location.state?.postId
  const { user } = useAuth()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [keyboardPad, setKeyboardPad] = useState(0)
  const [failedDraft, setFailedDraft] = useState(null)
  const bottomRef = useRef(null)
  const topRef = useRef(null)
  const visible = usePageVisible()

  const {
    data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['thread', peerId],
    queryFn: ({ pageParam }) => api.getThread(peerId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user,
    refetchInterval: pollInterval(visible, 8000),
  })
  const list = data ? [...data.pages].reverse().flatMap(p => p.list) : []
  const peer = data?.pages?.[0]?.peer

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

  const observeTop = useCallback((node) => {
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '100px' })
    io.observe(node)
    return io
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  useEffect(() => {
    const io = observeTop(topRef.current)
    return () => io?.disconnect()
  }, [observeTop])

  const pageCount = data?.pages.length ?? 0
  useEffect(() => {
    if (pageCount <= 1) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [list.length, pageCount])

  const sendMutation = useMutation({
    mutationFn: (content) => api.sendMessage(peerId, content, fromPostId, { silentError: true }),
    onMutate: async (content) => {
      await qc.cancelQueries({ queryKey: ['thread', peerId] })
      const prev = qc.getQueryData(['thread', peerId])
      const tempId = `temp-${Date.now()}`
      const optimistic = {
        id: tempId,
        sender_id: user.id,
        receiver_id: peerId,
        content,
        created_at: Date.now(),
        pending: true,
      }
      qc.setQueryData(['thread', peerId], (old) => {
        if (!old?.pages?.length) {
          return {
            pages: [{ list: [optimistic], peer: null, page: 1, hasMore: false }],
            pageParams: [1],
          }
        }
        const pages = old.pages.map((p, i) => (
          i === 0 ? { ...p, list: [...(p.list || []), optimistic] } : p
        ))
        return { ...old, pages }
      })
      setText('')
      setFailedDraft(null)
      return { prev, content }
    },
    onError: (e, _content, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['thread', peerId], ctx.prev)
      if (ctx?.content) {
        setText(ctx.content)
        setFailedDraft(ctx.content)
      }
      toast.error(e.message || '发送失败')
    },
    onSuccess: () => {
      setFailedDraft(null)
      qc.invalidateQueries({ queryKey: ['thread', peerId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['unread'] })
    },
  })

  const handleSend = () => {
    const t = text.trim()
    if (!t || sendMutation.isPending) return
    sendMutation.mutate(t)
  }

  const handleResend = () => {
    if (!failedDraft || sendMutation.isPending) return
    setText(failedDraft)
    sendMutation.mutate(failedDraft)
  }

  if (!user) {
    return (
      <AppShell>
        <EmptyState title="请先登录" actionLabel="去登录" onAction={() => navigate('/login')} illustration={<EmptyMessages />} />
      </AppShell>
    )
  }

  return (
    <AppShell style={{ paddingBottom: `calc(72px + ${keyboardPad}px)` }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 8px', minHeight: 52,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <button type="button" aria-label="返回" onClick={() => navigate(-1)} style={iconBtn}>
          <BackIcon size={22} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {peer?.nickname || '邻居'}
          </div>
          {peer?.building ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{peer.building}{peer.unit || ''}</div>
          ) : null}
        </div>
      </header>

      {isLoading && <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>加载中…</div>}
      {!isLoading && isError && <ListError onRetry={() => refetch()} />}
      {!isLoading && !isError && list.length === 0 && (
        <EmptyState title="还没有消息" description="打个招呼吧" illustration={<EmptyMessages />} />
      )}

      <div style={{ padding: '12px 16px 16px' }}>
        {list.length > 0 && (
          <div ref={topRef} style={{ textAlign: 'center', padding: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {isFetchingNextPage ? '加载中…' : !hasNextPage ? '没有更早的消息了' : ''}
          </div>
        )}
        {list.map(m => {
          const mine = m.sender_id === user.id
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              <div style={{
                maxWidth: '72%',
                padding: '10px 14px',
                borderRadius: 16,
                background: mine ? 'var(--color-primary)' : 'var(--color-surface)',
                color: mine ? 'var(--color-on-primary)' : 'var(--color-text)',
                border: mine ? 'none' : '1px solid var(--color-border)',
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
        <div ref={bottomRef} />
      </div>

      {failedDraft ? (
        <div style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: `calc(64px + ${keyboardPad}px + env(safe-area-inset-bottom))`,
          width: '100%', maxWidth: 480, padding: '0 16px', boxSizing: 'border-box', zIndex: 30,
        }}>
          <button
            type="button"
            onClick={handleResend}
            style={{
              width: '100%', border: 'none', borderRadius: 12, padding: '8px 12px',
              background: 'var(--color-bg-accent)', color: 'var(--color-danger)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            发送失败，点此重送
          </button>
        </div>
      ) : null}

      <div style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: keyboardPad,
        width: '100%', maxWidth: 480,
        display: 'flex', gap: 8, alignItems: 'center',
        padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        boxSizing: 'border-box',
        zIndex: 40,
      }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="发条私信..."
          style={{
            flex: 1, minHeight: 44, borderRadius: 999, border: '1.5px solid var(--color-border)',
            background: 'var(--color-bg)', color: 'var(--color-text)', padding: '0 16px',
            fontSize: 15, outline: 'none',
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
    </AppShell>
  )
}

const iconBtn = {
  width: 44, height: 44, border: 'none', borderRadius: 22,
  background: 'transparent', color: 'var(--color-text)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
