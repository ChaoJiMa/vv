import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'
import { safeParse } from '../utils/image'
import {
  AppShell, Button, Field, IconBtn, Sheet, Sticker,
} from '../components/ui'
import {
  BackIcon, CopyIcon, FlagIcon, MenuIcon, RefreshIcon,
} from '../components/icons'

const RESPOND_LABEL = {
  help: '我要帮忙',
  idle: '我想要',
  lost: '这是我的',
}

export default function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [adoptAuto, setAdoptAuto] = useState(false)
  const [reportTarget, setReportTarget] = useState(null)
  const [viewerIdx, setViewerIdx] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteCommentId, setDeleteCommentId] = useState(null)

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const { data: post, isLoading, isError, refetch } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
  })

  const {
    data: commentData, fetchNextPage, hasNextPage, isFetchingNextPage, refetch: refetchComments,
  } = useInfiniteQuery({
    queryKey: ['comments', id],
    queryFn: ({ pageParam }) => api.getComments(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const comments = commentData?.pages.flatMap(p => p.list) ?? []
  const commentTotal = commentData?.pages?.[0]?.total ?? post?.comment_count ?? 0

  const commentMutation = useMutation({
    mutationFn: (text) => api.addComment(id, text),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['comments', id] })
      qc.invalidateQueries({ queryKey: ['post', id] })
    },
    onError: (e) => toast.error(e.message || '发送失败'),
  })

  const closeMutation = useMutation({
    mutationFn: (helpers) => api.closePost(id, helpers),
    onSuccess: () => {
      setAdoptOpen(false)
      toast.success('已完成')
      qc.invalidateQueries({ queryKey: ['post', id] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myStats'] })
    },
    onError: (e) => toast.error(e.message || '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.removeQueries({ queryKey: ['post', id] })
      navigate('/')
    },
    onError: (e) => toast.error(e.message || '删除失败'),
  })

  const respondMutation = useMutation({
    mutationFn: () => api.respondPost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post', id] })
      navigate(`/messages/${post.user_id}`, { state: { postId: id } })
    },
    onError: (e) => toast.error(e.message || '响应失败'),
  })

  const unrespondMutation = useMutation({
    mutationFn: () => api.unrespondPost(id),
    onSuccess: () => {
      toast.success('已取消响应')
      qc.invalidateQueries({ queryKey: ['post', id] })
    },
    onError: (e) => toast.error(e.message || '取消失败'),
  })

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId) => api.deleteComment(commentId),
    onSuccess: () => {
      setDeleteCommentId(null)
      qc.invalidateQueries({ queryKey: ['comments', id] })
      qc.invalidateQueries({ queryKey: ['post', id] })
    },
    onError: (e) => toast.error(e.message || '删除失败'),
  })

  const reportMutation = useMutation({
    mutationFn: ({ targetType, targetId, reason }) => api.reportContent(targetType, targetId, reason),
    onSuccess: () => {
      setReportTarget(null)
      toast.success('举报已提交,我们会尽快核实')
    },
    onError: (e) => {
      setReportTarget(null)
      toast.error(e.message || '举报失败')
    },
  })

  const sentinelRef = useRef(null)
  const observe = useCallback((node) => {
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(node)
    return io
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  useEffect(() => {
    const io = observe(sentinelRef.current)
    return () => io?.disconnect()
  }, [observe])

  if (isLoading) {
    return <AppShell><div style={{ textAlign: 'center', padding: 64, color: 'var(--color-text-muted)' }}>加载中…</div></AppShell>
  }
  if (isError || !post) {
    return (
      <AppShell>
        <div style={{ textAlign: 'center', padding: 64 }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>{isError ? '加载失败' : '帖子不存在'}</p>
          {isError ? <Button type="button" onClick={() => refetch()}>重试</Button> : <Button type="button" onClick={() => navigate('/')}>回首页</Button>}
        </div>
      </AppShell>
    )
  }

  const menu = menuMap[post.type]
  const postImages = safeParse(post.images)

  if (!adoptAuto && location.state?.openAdopt) {
    if (user && user.id === post.user_id && post.status === 'open') setAdoptOpen(true)
    setAdoptAuto(true)
  }

  const copyContact = async () => {
    if (!post.contact) return
    try {
      await navigator.clipboard.writeText(post.contact)
      toast.success('已复制联系方式')
    } catch {
      toast.info(post.contact)
    }
  }

  return (
    <AppShell style={{ paddingBottom: 88 }}>
      <header style={headerBar}>
        <IconBtn ariaLabel="返回" onClick={() => navigate(-1)}><BackIcon size={22} /></IconBtn>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MenuIcon type={post.type} size={18} style={{ color: 'var(--color-primary)' }} />
          <div style={{ fontWeight: 700, fontSize: 16 }}>{menu?.label || post.type}</div>
        </div>
        {post.status === 'closed' && <Sticker active={false} color="cream" style={{ minHeight: 28, padding: '4px 10px', pointerEvents: 'none' }}>已完成</Sticker>}
        <button type="button" onClick={() => { refetch(); refetchComments() }} style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <RefreshIcon size={16} /> 刷新
        </button>
      </header>

      {postImages.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: postImages.length === 1 ? '1fr' : 'repeat(3, 1fr)',
          gap: 8, padding: '12px 16px 0',
        }}>
          {postImages.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => setViewerIdx(i)}
              style={{
                position: 'relative', paddingTop: postImages.length === 1 ? '56%' : '100%',
                border: 'none', borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
                background: 'var(--color-bg-accent)', padding: 0,
              }}
            >
              <img src={api.imgUrl(key)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      ) : (
        <div style={{
          margin: '12px 16px 0', padding: 28, borderRadius: 'var(--radius-card)',
          background: 'var(--color-bg-accent)', display: 'flex', justifyContent: 'center', color: 'var(--color-primary)',
        }}>
          <MenuIcon type={post.type} size={48} />
        </div>
      )}

      <section style={{ padding: '16px 16px 12px' }}>
        {menu?.label && (
          <Sticker active={false} color="cream" style={{ minHeight: 28, padding: '4px 10px', marginBottom: 10, pointerEvents: 'none' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <MenuIcon type={post.type} size={14} />
              {menu.label}
            </span>
          </Sticker>
        )}
        <h1 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800, lineHeight: 1.35 }}>{post.title}</h1>
        {post.content && (
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{post.content}</p>
        )}

        {(post.location || post.contact || post.contactUnavailable || (user && user.id !== post.user_id && !post.myResponded && RESPOND_LABEL[post.type])) && (
          <div style={{
            padding: 12, borderRadius: 14, marginBottom: 12,
            background: 'var(--color-bg-accent)', border: '1px solid var(--color-border)',
          }}>
            {post.location && <div style={metaLine}>📍 {post.location}</div>}
            {post.contact && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...metaLine, flex: 1 }}>📞 {post.contact}</span>
                <button type="button" onClick={copyContact} style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CopyIcon size={14} /> 复制
                </button>
              </div>
            )}
            {post.contactUnavailable && <div style={{ ...metaLine, color: 'var(--color-danger)' }}>联系方式暂时无法显示</div>}
            {user && user.id !== post.user_id && !post.myResponded && !post.contact && !post.contactUnavailable && RESPOND_LABEL[post.type] && post.status === 'open' && (
              <div style={metaLine}>响应后可查看联系方式</div>
            )}
            <div style={{ ...metaLine, marginTop: 4, fontSize: 11 }}>仅相关邻居可见联系方式</div>
          </div>
        )}

        {post.helpers?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>感谢:</span>
            {post.helpers.map(h => (
              <Sticker key={h.helper_id} active={false} color="mint" style={{ minHeight: 28, padding: '4px 10px', pointerEvents: 'none', fontSize: 12 }}>
                {h.thanked ? '🙏 ' : ''}{h.nickname || '邻居'}
              </Sticker>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.building || ''}{post.unit || ''}邻居 · {post.nickname}
            </span>
            {user && user.id !== post.user_id && (
              <IconBtn ariaLabel="举报" onClick={() => setReportTarget({ type: 'post', id })} style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, color: 'var(--color-text-muted)' }}>
                <FlagIcon size={16} />
              </IconBtn>
            )}
          </div>

          {user && user.id === post.user_id && (
            <div style={{ display: 'flex', gap: 6 }}>
              {post.status === 'open' && (
                <>
                  <Button type="button" variant="secondary" style={smBtn} onClick={() => navigate(`/edit/${id}`)}>编辑</Button>
                  <Button type="button" style={smBtn} onClick={() => setAdoptOpen(true)} disabled={closeMutation.isPending}>标记完成</Button>
                </>
              )}
              <Button type="button" variant="ghost" style={{ ...smBtn, color: 'var(--color-danger)' }} onClick={() => setDeleteOpen(true)} disabled={deleteMutation.isPending}>删除</Button>
            </div>
          )}

          {!user && (
            <Button type="button" style={smBtn} onClick={() => navigate('/login', { state: { from: location } })}>登录后参与</Button>
          )}

          {user && user.id !== post.user_id && (
            RESPOND_LABEL[post.type] ? (
              post.myResponded ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button type="button" variant="secondary" style={smBtn} onClick={() => navigate(`/messages/${post.user_id}`, { state: { postId: id } })}>私信</Button>
                  {post.status === 'open' && (
                    <Button type="button" variant="ghost" style={smBtn} onClick={() => unrespondMutation.mutate()} loading={unrespondMutation.isPending}>取消响应</Button>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  style={smBtn}
                  onClick={() => respondMutation.mutate()}
                  loading={respondMutation.isPending}
                  disabled={post.status === 'closed'}
                >
                  {RESPOND_LABEL[post.type]}
                </Button>
              )
            ) : (
              <Button type="button" variant="secondary" style={smBtn} onClick={() => navigate(`/messages/${post.user_id}`, { state: { postId: id } })}>私信 TA</Button>
            )
          )}
        </div>
      </section>

      {RESPOND_LABEL[post.type] && post.responses?.length > 0 && (
        <section style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-accent)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>{post.responses.length} 位邻居已响应</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {post.responses.map(r => (
              <Sticker key={r.user_id} active={false} color="sky" style={{ minHeight: 28, padding: '4px 10px', pointerEvents: 'none', fontSize: 12 }}>
                {r.nickname || '邻居'}{r.building ? ` · ${r.building}` : ''}
              </Sticker>
            ))}
          </div>
        </section>
      )}

      <section style={{ padding: '14px 16px 24px', borderTop: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>共 {commentTotal} 条回复</div>
        {comments.map(c => (
          <div key={c.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12 }}>
              <strong style={{ color: 'var(--color-text)' }}>{c.nickname}</strong>
              <span style={{ color: 'var(--color-text-muted)' }}>{c.building || ''}</span>
              {user && user.id === c.user_id && (
                <button type="button" onClick={() => setDeleteCommentId(c.id)} style={{ ...linkBtn, marginLeft: 'auto', color: 'var(--color-danger)' }}>删除</button>
              )}
              {user && user.id !== c.user_id && (
                <button type="button" onClick={() => setReportTarget({ type: 'comment', id: c.id })} style={{ ...linkBtn, marginLeft: 'auto' }}>举报</button>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{c.content}</p>
          </div>
        ))}
        {comments.length > 0 && (
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {isFetchingNextPage ? '加载中…' : ''}
          </div>
        )}
      </section>

      <div style={composerBar}>
        <input
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={user ? '写下你的回复...' : '登录后才能回复'}
          disabled={!user}
          style={{
            flex: 1, minHeight: 44, borderRadius: 999, border: '1.5px solid var(--color-border)',
            background: 'var(--color-bg)', color: 'var(--color-text)', padding: '0 16px', fontSize: 14, outline: 'none',
          }}
        />
        <Button
          type="button"
          onClick={() => user ? commentMutation.mutate(comment.trim()) : navigate('/login')}
          loading={commentMutation.isPending}
          disabled={user && !comment.trim()}
          style={{ borderRadius: 999, minWidth: 72 }}
        >
          发送
        </Button>
      </div>

      {adoptOpen && (
        <AdoptSheet
          open={adoptOpen}
          onClose={() => setAdoptOpen(false)}
          postId={id}
          postType={post.type}
          onConfirm={(helpers) => closeMutation.mutate(helpers)}
          submitting={closeMutation.isPending}
        />
      )}

      {reportTarget && (
        <ReportSheet
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
          targetType={reportTarget.type}
          submitting={reportMutation.isPending}
          onSubmit={(reason) => reportMutation.mutate({ targetType: reportTarget.type, targetId: reportTarget.id, reason })}
        />
      )}

      {viewerIdx !== null && postImages[viewerIdx] && (
        <div
          role="presentation"
          onClick={() => setViewerIdx(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <img src={api.imgUrl(postImages[viewerIdx])} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          {postImages.length > 1 && (
            <div style={{ position: 'absolute', top: 'calc(16px + env(safe-area-inset-top))', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 13 }}>
              {viewerIdx + 1} / {postImages.length}
            </div>
          )}
          <IconBtn ariaLabel="关闭" onClick={(e) => { e.stopPropagation(); setViewerIdx(null) }} style={{ position: 'absolute', top: 'calc(8px + env(safe-area-inset-top))', right: 8, color: '#fff' }}>
            <BackIcon size={22} />
          </IconBtn>
        </div>
      )}

      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title="确定删除这条帖子吗?" heightVh={28}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>删除后不可恢复。</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setDeleteOpen(false)}>取消</Button>
          <Button type="button" loading={deleteMutation.isPending} style={{ flex: 1, background: 'var(--color-danger)' }} onClick={() => deleteMutation.mutate()}>删除</Button>
        </div>
      </Sheet>

      <Sheet open={!!deleteCommentId} onClose={() => setDeleteCommentId(null)} title="删除这条评论?" heightVh={28}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>删除后不可恢复。</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setDeleteCommentId(null)}>取消</Button>
          <Button
            type="button"
            loading={deleteCommentMutation.isPending}
            style={{ flex: 1, background: 'var(--color-danger)' }}
            onClick={() => deleteCommentMutation.mutate(deleteCommentId)}
          >
            删除
          </Button>
        </div>
      </Sheet>
    </AppShell>
  )
}

function AdoptSheet({ open, onClose, postId, postType, onConfirm, submitting }) {
  const multi = postType === 'help'
  const [picks, setPicks] = useState({})
  const [inited, setInited] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['helperCandidates', postId],
    queryFn: () => api.getHelperCandidates(postId),
    enabled: open,
  })
  const candidates = data?.candidates ?? []

  if (!inited && !isLoading) {
    if (multi && candidates.length > 0) {
      const all = {}
      candidates.forEach(p => { all[p.id] = 'thank' })
      setPicks(all)
    }
    setInited(true)
  }

  const toggleAdopt = (uid) => {
    setPicks(prev => {
      if (multi) {
        const next = { ...prev }
        if (next[uid]) delete next[uid]
        else next[uid] = 'thank'
        return next
      }
      return prev[uid] ? {} : { [uid]: 'thank' }
    })
  }
  const toggleThank = (uid) => {
    setPicks(prev => {
      if (!prev[uid]) return prev
      return { ...prev, [uid]: prev[uid] === 'thank' ? true : 'thank' }
    })
  }

  const pickedCount = Object.keys(picks).length

  return (
    <Sheet open={open} onClose={onClose} title="完成并感谢帮助你的邻居" heightVh={62}>
      {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>加载中…</div>}
      {!isLoading && candidates.length === 0 && (
        <p style={{ margin: '8px 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>还没有邻居响应。可直接完成。</p>
      )}
      {!isLoading && candidates.length > 0 && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {multi ? '可采纳多位帮你的邻居' : '只能采纳一位(物品/失物归属唯一)'}
        </p>
      )}
      <div style={{ flex: 1 }}>
        {candidates.map(p => {
          const state = picks[p.id]
          const adopted = !!state
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>
                {p.nickname}
                {p.building ? <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}> · {p.building}</span> : null}
              </div>
              {adopted && (
                <button type="button" onClick={() => toggleThank(p.id)} style={{ ...linkBtn, color: state === 'thank' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                  {state === 'thank' ? '🙏 已感谢' : '🙏 感谢'}
                </button>
              )}
              <Button
                type="button"
                variant={adopted ? 'primary' : 'secondary'}
                style={smBtn}
                onClick={() => toggleAdopt(p.id)}
              >
                {adopted ? '已采纳' : '采纳'}
              </Button>
            </div>
          )
        })}
      </div>
      <Button
        type="button"
        loading={submitting}
        style={{ width: '100%', marginTop: 12 }}
        onClick={() => onConfirm(Object.entries(picks).map(([helperId, v]) => ({ helperId, thanked: v === 'thank' })))}
      >
        {pickedCount > 0 ? `完成并采纳 ${pickedCount} 位邻居` : '直接完成(不采纳)'}
      </Button>
    </Sheet>
  )
}

const REPORT_REASONS = ['垃圾广告 / 引流', '欺诈 / 虚假信息', '色情低俗', '辱骂 / 人身攻击', '违法违禁', '其他']

function ReportSheet({ open, onClose, targetType, onSubmit, submitting }) {
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')
  const isOther = reason === '其他'
  const finalReason = isOther ? (custom.trim() || '其他') : reason
  const label = targetType === 'post' ? '帖子' : '评论'

  return (
    <Sheet open={open} onClose={onClose} title={`举报${label}`} heightVh={52}>
      <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--color-text-muted)' }}>请选择举报原因,我们会尽快核实处理。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {REPORT_REASONS.map(r => (
          <Sticker key={r} active={reason === r} color="cream" onClick={() => setReason(r)}>
            {r}
          </Sticker>
        ))}
      </div>
      {isOther && (
        <Field
          as="textarea"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          placeholder="补充说明(可选)"
          maxLength={200}
          style={{ marginBottom: 12 }}
        />
      )}
      <Button type="button" loading={submitting} disabled={!reason} style={{ width: '100%' }} onClick={() => onSubmit(finalReason)}>
        提交举报
      </Button>
    </Sheet>
  )
}

const headerBar = {
  position: 'sticky', top: 0, zIndex: 20,
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '6px 8px', minHeight: 52,
  background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
  backdropFilter: 'blur(10px)',
  borderBottom: '1px solid var(--color-border)',
}
const composerBar = {
  position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0,
  width: '100%', maxWidth: 480, display: 'flex', gap: 8, alignItems: 'center',
  padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
  background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)',
  boxSizing: 'border-box', zIndex: 40,
}
const linkBtn = {
  border: 'none', background: 'transparent', color: 'var(--color-text-muted)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36, padding: '4px 8px',
}
const smBtn = { minHeight: 36, padding: '6px 12px', fontSize: 13 }
const metaLine = { fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }
