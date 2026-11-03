import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { captureSession, assertSessionCurrent, isSessionCurrent } from '../session'
import { useAuth } from '../hooks/useAuth'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import { toast } from '../toast'
import { coverAspectRatio, imageKeys } from '../utils/image'
import { resolveAvatarUrl } from '../utils/avatar'
import { formatResidence } from '../utils/residence'
import {
  clampDetailAspect, detailCoverHeightPx, NO_IMAGE_ASPECT,
} from '../utils/imageAspect'
import {
  AppShell, Button, Field, IconBtn, Sheet, Sticker,
} from '../components/ui'
import {
  BackIcon, CopyIcon, FlagIcon, HeartIcon, MenuSticker, RefreshIcon,
} from '../components/icons'
import {
  formatRelativeTime, getTypeTheme, timeBadgeStyle, typePillStyle,
} from '../utils/typeTheme'

const RESPOND_LABEL = {
  help: '我要帮忙',
  idle: '我想要',
  lost: '这是我的',
}

function loadDetailAspect(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(clampDetailAspect((img.naturalHeight || 1) / (img.naturalWidth || 1)))
    img.onerror = () => resolve(1)
    img.src = url
  })
}

function coverWidthPx() {
  if (typeof window === 'undefined') return 390
  return Math.min(window.innerWidth, 480)
}

export default function PostDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  // 公开详情页不会随账号切换离开；重建局部状态，避免旧账号输入/旧帖子回复目标串用。
  return <PostDetailContent key={`${user?.id || 'guest'}:${id}`} id={id} user={user} />
}

/** 帖子详情及评论交互；实例按账号和帖子隔离，保留各自查询缓存。 */
function PostDetailContent({ id, user }) {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [adoptAuto, setAdoptAuto] = useState(false)
  const [reportTarget, setReportTarget] = useState(null)
  const [viewerIdx, setViewerIdx] = useState(null)
  const [coverIdx, setCoverIdx] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteCommentId, setDeleteCommentId] = useState(null)
  const [likeBusy, setLikeBusy] = useState(false)
  const [authorMenuOpen, setAuthorMenuOpen] = useState(false)
  const [asyncAspect, setAsyncAspect] = useState(null)
  const [asyncThumb, setAsyncThumb] = useState(null)
  /** { commentId, nickname } 底栏回复模式 */
  const [replyTo, setReplyTo] = useState(null)
  /** commentId -> { list, page, hasMore, loading, expanded } */
  const [replyExpand, setReplyExpand] = useState({})
  const [deleteReplyId, setDeleteReplyId] = useState(null)
  const coverScrollRef = useRef(null)
  const commentInputRef = useRef(null)
  // 内容或回复目标被重新编辑后，迟到的提交成功不能清空新的输入。
  const commentRevision = useRef(0)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const { data: post, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['post', id, user?.id],
    queryFn: async () => {
      const data = await api.getPost(id)
      // 仅首次用详情附带的首页播种，刷新详情不能截断已加载的后续评论页。
      if (data?.comments && !qc.getQueryData(['comments', id])?.pages?.length) {
        qc.setQueryData(['comments', id], {
          pages: [data.comments],
          pageParams: [1],
        })
      }
      return data
    },
  })
  const isRefreshing = isFetching && !isLoading
  // 临时刷新失败仍可读旧内容；服务端明确表示不存在/无权访问时必须撤下缓存详情。
  const postUnavailable = isError && [401, 403, 404, 2001].includes(error?.code)

  const {
    data: commentData, fetchNextPage, hasNextPage, isFetchingNextPage, refetch: refetchComments,
    isError: commentsError, isFetching: commentsFetching, isFetchNextPageError: commentsNextError,
    isLoading: commentsLoading,
  } = useInfiniteQuery({
    queryKey: ['comments', id],
    queryFn: ({ pageParam }) => api.getComments(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    // 等详情写入首页后再启用；首页走缓存，仅翻页打 comments
    enabled: !!post,
    staleTime: 60 * 1000,
  })
  const comments = commentData?.pages.flatMap(p => p.list) ?? []
  // 总数含二级回复（以后端 stats 为准）
  const commentTotal = post?.stats?.commentCount
    ?? post?.comment_count
    ?? commentData?.pages?.[0]?.total
    ?? post?.comments?.total
    ?? 0

  const postThumb = post ? (imageKeys(post.images, post.cover)[0] || null) : null
  const knownAspect = post ? coverAspectRatio(post) : null
  if (postThumb !== asyncThumb) {
    setAsyncThumb(postThumb)
    setAsyncAspect(null)
  }
  useEffect(() => {
    if (!postThumb || knownAspect != null) return undefined
    let cancelled = false
    loadDetailAspect(api.imgUrl(postThumb)).then((aspect) => {
      if (!cancelled) setAsyncAspect(aspect)
    })
    return () => { cancelled = true }
  }, [postThumb, knownAspect])

  const coverAspect = !postThumb
    ? NO_IMAGE_ASPECT
    : (knownAspect != null ? knownAspect : (asyncAspect ?? 1))
  const coverH = detailCoverHeightPx({ aspect: coverAspect, widthPx: coverWidthPx() })

  const refreshComments = () => {
    qc.invalidateQueries({ queryKey: ['comments', id] })
    qc.invalidateQueries({ queryKey: ['post', id, user?.id] })
    setReplyExpand({})
  }

  const commentMutation = useMutation({
    mutationFn: ({ text, replyTarget, session }) => {
      assertSessionCurrent(session)
      return replyTarget
        ? api.addCommentReply(replyTarget.commentId, text)
        : api.addComment(id, text)
    },
    onSuccess: (_data, submission) => {
      // 请求完成时页面/账号可能已切换，旧实例不能再刷新新实例或改写输入。
      if (!active.current || !isSessionCurrent(submission.session)) return
      if (commentRevision.current === submission.revision) {
        setComment('')
        setReplyTo(null)
      }
      refreshComments()
    },
    onError: (e, submission) => {
      if (active.current && isSessionCurrent(submission.session)) toast.error(e.message || '发送失败')
    },
  })

  const deleteReplyMutation = useMutation({
    mutationFn: (replyId) => api.deleteCommentReply(replyId),
    onSuccess: () => {
      setDeleteReplyId(null)
      refreshComments()
    },
    onError: (e) => toast.error(e.message || '删除失败'),
  })

  const closeMutation = useMutation({
    mutationFn: (helpers) => api.closePost(id, helpers),
    onSuccess: () => {
      setAdoptOpen(false)
      setAuthorMenuOpen(false)
      toast.success('已完成')
      qc.invalidateQueries({ queryKey: ['post', id, user?.id] })
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
      qc.removeQueries({ queryKey: ['post', id, user?.id] })
      navigate('/')
    },
    onError: (e) => toast.error(e.message || '删除失败'),
  })

  const openConversation = async (authorUserId) => {
    const peer = authorUserId || post?.author?.id || post?.user_id
    if (!peer) {
      toast.error('无法私信')
      return
    }
    try {
      const data = await api.ensureConversation(peer, id)
      navigate(`/messages/${data.conversationId}`)
    } catch (e) {
      toast.error(e.message || '打开会话失败')
    }
  }

  const respondMutation = useMutation({
    mutationFn: async () => {
      await api.respondPost(id)
      const peer = post.author?.id || post.user_id
      try {
        const data = await api.ensureConversation(peer, id)
        return { conversationId: data.conversationId }
      } catch (e) {
        return { ensureError: e }
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['post', id, user?.id] })
      if (result?.conversationId) {
        navigate(`/messages/${result.conversationId}`)
        return
      }
      toast.error(result?.ensureError?.message || '已响应，打开私信失败，请再点「私信」')
    },
    onError: (e) => toast.error(e.message || '响应失败'),
  })

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId) => api.deleteComment(commentId),
    onSuccess: () => {
      setDeleteCommentId(null)
      refreshComments()
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

  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    enabled: !!post && !postUnavailable && comments.length > 0 && !commentsError && !commentsFetching,
  })

  if (isLoading) {
    return <AppShell><div style={{ textAlign: 'center', padding: 64, color: 'var(--color-text-muted)' }}>加载中…</div></AppShell>
  }
  if (!post || postUnavailable) {
    return (
      <AppShell>
        <div style={{ textAlign: 'center', padding: 64 }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>{postUnavailable ? '帖子不存在或无法访问' : isError ? '加载失败' : '帖子不存在'}</p>
          {isError ? <Button type="button" onClick={() => refetch()}>重试</Button> : <Button type="button" onClick={() => navigate('/')}>回首页</Button>}
        </div>
      </AppShell>
    )
  }

  const postImages = imageKeys(post.images, post.cover)
  const theme = getTypeTheme(post.type)
  const timeLabel = formatRelativeTime(post.createdAt ?? post.created_at)
  const closed = post.status === 'closed'
  const authorId = post.author?.id || post.user_id
  const nickname = (post.author?.nickname || post.nickname || '').trim() || '邻居'
  const avatarSrc = resolveAvatarUrl(post.author?.avatar ?? post.avatar)
  const building = post.author?.building ?? post.building
  const liked = !!(post.viewer?.liked ?? post.myLiked ?? post.my_liked)
  const likeCount = Number(post.stats?.likeCount ?? post.like_count) || 0
  const responded = !!(post.viewer?.responded ?? post.myResponded)
  const isAuthor = !!(user && user.id === authorId)
  // 作者资料行仅显示楼栋；不从旧缓存或本人专用响应把房号带到公开作者区。
  // 帖子 location 是用户填写的公开内容，继续在正文位置区保留原值。
  const locLine = formatResidence(building, '')
  const initial = nickname === '邻居' ? '邻' : (nickname[0] || '邻')

  if (!adoptAuto && location.state?.openAdopt) {
    if (user && user.id === authorId && post.status === 'open') setAdoptOpen(true)
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

  const onCoverScroll = () => {
    const el = coverScrollRef.current
    if (!el || !postImages.length) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== coverIdx) setCoverIdx(i)
  }

  const toggleLike = async () => {
    if (!user) {
      navigate('/login', { state: { from: location } })
      return
    }
    if (likeBusy) return
    setLikeBusy(true)
    try {
      const data = liked ? await api.unlikePost(id) : await api.likePost(id)
      const nextLiked = !!data.liked
      const nextCount = Number(data.likeCount ?? data.like_count) || 0
      qc.setQueryData(['post', id, user?.id], (old) => old ? {
        ...old,
        myLiked: nextLiked,
        my_liked: nextLiked,
        like_count: nextCount,
        viewer: { ...(old.viewer || {}), liked: nextLiked },
        stats: { ...(old.stats || {}), likeCount: nextCount },
      } : old)
    } catch (e) {
      toast.error(e.message || '操作失败')
    } finally {
      setLikeBusy(false)
    }
  }

  const sendComment = () => {
    if (!user) {
      navigate('/login', { state: { from: location } })
      return
    }
    const text = comment.trim()
    if (!text || commentMutation.isPending) return
    commentMutation.mutate({ text, replyTarget: replyTo, revision: commentRevision.current, session: captureSession() })
  }

  const startReply = (c) => {
    if (!user) {
      navigate('/login', { state: { from: location } })
      return
    }
    commentRevision.current++
    setReplyTo({ commentId: c.id, nickname: c.nickname || '邻居' })
    commentInputRef.current?.focus()
  }

  const togglePin = async (c) => {
    try {
      if (c.pinned || c.pinnedAt || c.pinned_at) await api.unpinComment(c.id)
      else await api.pinComment(c.id)
      refreshComments()
    } catch (e) {
      toast.error(e.message || '操作失败')
    }
  }

  const expandReplies = async (c) => {
    const cur = replyExpand[c.id]
    const nextPage = cur?.expanded ? (cur.page || 1) + 1 : 1
    setReplyExpand((prev) => ({
      ...prev,
      // expanded/page 只在成功后推进；首屏失败继续使用预览和原“更多”入口重试第 1 页。
      [c.id]: { ...(prev[c.id] || {}), loading: true },
    }))
    try {
      const data = await api.getCommentReplies(c.id, nextPage)
      setReplyExpand((prev) => {
        const prevList = nextPage === 1 ? [] : (prev[c.id]?.list || [])
        const seen = new Set(prevList.map((r) => r.id))
        const merged = [...prevList, ...(data.list || []).filter((r) => !seen.has(r.id))]
        return {
          ...prev,
          [c.id]: {
            list: merged,
            page: data.page,
            hasMore: data.hasMore,
            loading: false,
            expanded: true,
            total: data.total,
          },
        }
      })
    } catch (e) {
      toast.error(e.message || '加载失败')
      setReplyExpand((prev) => ({
        ...prev,
        [c.id]: { ...(prev[c.id] || {}), loading: false },
      }))
    }
  }

  const visibleReplies = (c) => {
    const ex = replyExpand[c.id]
    if (ex?.expanded && ex.list) return ex.list
    return c.replies?.list || []
  }

  const repliesHasMore = (c) => {
    const ex = replyExpand[c.id]
    if (ex?.expanded) return !!ex.hasMore
    return !!(c.replies?.hasMore)
  }

  const repliesMoreCount = (c) => {
    const total = c.replies?.total ?? 0
    const shown = visibleReplies(c).length
    return Math.max(0, total - shown)
  }

  const renderBottomPrimary = () => {
    if (!user) {
      return (
        <Button type="button" style={barPrimaryBtn} onClick={() => navigate('/login', { state: { from: location } })}>
          登录
        </Button>
      )
    }
    if (isAuthor) {
      return (
        <button
          type="button"
          aria-label="更多"
          onClick={() => setAuthorMenuOpen(true)}
          style={moreBtn}
        >
          ⋯
        </button>
      )
    }
    if (RESPOND_LABEL[post.type]) {
      if (responded) {
        return (
          <Button
            type="button"
            style={barPrimaryBtn}
            onClick={() => openConversation(authorId)}
          >
            私信
          </Button>
        )
      }
      return (
        <Button
          type="button"
          style={barPrimaryBtn}
          onClick={() => respondMutation.mutate()}
          loading={respondMutation.isPending}
          disabled={closed}
        >
          {RESPOND_LABEL[post.type]}
        </Button>
      )
    }
    return (
      <Button
        type="button"
        variant="secondary"
        style={barPrimaryBtn}
        onClick={() => openConversation(authorId)}
      >
        私信 TA
      </Button>
    )
  }

  return (
    <AppShell style={{ paddingBottom: 'calc(96px + var(--safe-bottom))' }}>
      {isError && !postUnavailable && (
        <div role="status" style={{ padding: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>刷新失败，已保留当前帖子</p>
          <Button variant="secondary" loading={isRefreshing} onClick={() => refetch()}>重试刷新帖子</Button>
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <header style={overlayHeader}>
          <IconBtn
            ariaLabel="返回"
            onClick={() => navigate(-1)}
            style={{ background: 'rgba(0,0,0,.35)', color: '#fff' }}
          >
            <BackIcon size={22} />
          </IconBtn>
          <div style={{ flex: 1 }} />
          <IconBtn
            ariaLabel="刷新"
            disabled={isRefreshing}
            onClick={async () => {
              await refetch()
              // 手动刷新也沿用评论查询的完整分页，不能用详情首页覆盖历史页。
              if (active.current) refetchComments()
            }}
            style={{ background: 'rgba(0,0,0,.35)', color: '#fff' }}
          >
            <RefreshIcon size={18} className={isRefreshing ? 'nh-spin' : undefined} />
          </IconBtn>
          {user && !isAuthor && (
            <IconBtn
              ariaLabel="举报"
              onClick={() => setReportTarget({ type: 'post', id })}
              style={{ background: 'rgba(0,0,0,.35)', color: '#fff', marginLeft: 6 }}
            >
              <FlagIcon size={18} />
            </IconBtn>
          )}
        </header>

        <div style={{ position: 'relative' }}>
          {postImages.length > 0 ? (
            <div style={{ position: 'relative', background: 'var(--color-bg-accent)' }}>
              <div
                ref={coverScrollRef}
                onScroll={onCoverScroll}
                style={{
                  display: 'flex',
                  overflowX: 'auto',
                  scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch',
                  scrollbarWidth: 'none',
                }}
                className="nh-detail-cover"
              >
                {postImages.map((key, i) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setViewerIdx(i)}
                    style={{
                      flex: '0 0 100%',
                      scrollSnapAlign: 'start',
                      border: 'none',
                      padding: 0,
                      height: coverH,
                      cursor: 'pointer',
                      background: 'transparent',
                    }}
                  >
                    <img
                      src={api.imgUrl(key)}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                ))}
              </div>
              {postImages.length > 1 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 40,
                  display: 'flex', justifyContent: 'center', gap: 6, pointerEvents: 'none',
                }}>
                  {postImages.map((_, i) => (
                    <span
                      key={i}
                      style={{
                        width: i === coverIdx ? 14 : 6, height: 6, borderRadius: 999,
                        background: i === coverIdx ? '#fff' : 'rgba(255,255,255,.5)',
                        transition: 'width .15s ease',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                // 无图正文使用轻量分类标记，不再用整幅装饰封面撑高首屏；安全区留给返回操作。
                height: 'calc(144px + var(--safe-top))',
                paddingTop: 'var(--safe-top)',
                boxSizing: 'border-box',
                background: 'transparent',
                borderBottom: '1px solid var(--color-border)',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MenuSticker type={post.type} size={36} style={{ position: 'relative', zIndex: 1, color: 'var(--color-text-muted)' }} />
            </div>
          )}

          {closed ? (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: 0,
                background: 'color-mix(in srgb, var(--color-bg) 35%, transparent)',
                pointerEvents: 'none',
              }}
            />
          ) : null}

          <div style={{
            position: 'absolute', left: 14, bottom: 14, zIndex: 2,
            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={typePillStyle(theme)}>{theme.label}</span>
            {closed ? (
              <span style={{ ...typePillStyle(theme), background: 'rgba(80,80,80,.75)', color: '#fff' }}>已结束</span>
            ) : null}
          </div>
          {timeLabel ? (
            <span style={{ position: 'absolute', right: 14, bottom: 14, zIndex: 2, ...timeBadgeStyle }}>
              {timeLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 16px 0',
      }}>
        <span style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, overflow: 'hidden',
          background: theme.pillBg, color: theme.pillFg,
        }}>
          {avatarSrc ? (
            <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : initial}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: 'var(--color-text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {nickname}
          </div>
          {locLine ? (
            <div style={{
              fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {locLine}
            </div>
          ) : null}
        </div>
      </div>

      <section style={{ padding: '12px 16px 14px' }}>
        <h1 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800, lineHeight: 1.35 }}>{post.title}</h1>
        {post.content && (
          <p style={{ margin: '0 0 14px', fontSize: 15, color: 'var(--color-text-muted)', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{post.content}</p>
        )}

        {(post.location || post.contact || post.contactUnavailable || (user && !isAuthor && !responded && RESPOND_LABEL[post.type])) && (
          <div style={{
            padding: '12px 14px', borderRadius: 16, marginBottom: 14,
            background: 'var(--color-bg-accent)',
          }}>
            {post.location && <div style={metaLine}>地点 · {post.location}</div>}
            {post.contact && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: post.location ? 6 : 0 }}>
                <span style={{ ...metaLine, flex: 1 }}>联系 · {post.contact}</span>
                <button type="button" onClick={copyContact} style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-primary)' }}>
                  <CopyIcon size={14} /> 复制
                </button>
              </div>
            )}
            {post.contactUnavailable && <div style={{ ...metaLine, color: 'var(--color-danger)', marginTop: 4 }}>联系方式暂时无法显示</div>}
            {user && !isAuthor && !responded && !post.contact && !post.contactUnavailable && RESPOND_LABEL[post.type] && post.status === 'open' && (
              <div style={{ ...metaLine, marginTop: 4 }}>响应后可查看联系方式</div>
            )}
            <div style={{ ...metaLine, marginTop: 6, fontSize: 11, opacity: 0.85 }}>仅相关邻居可见联系方式</div>
          </div>
        )}

        {post.helpers?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>感谢:</span>
            {post.helpers.map(h => (
              <Sticker key={h.helperId || h.helper_id} active={false} color="mint" style={{ minHeight: 28, padding: '4px 10px', pointerEvents: 'none', fontSize: 12, gap: 4 }}>
                {h.thanked ? <HeartIcon size={13} /> : null}{h.nickname || '邻居'}
              </Sticker>
            ))}
          </div>
        )}
      </section>

      {RESPOND_LABEL[post.type] && post.responses?.length > 0 && (
        <section style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-accent)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>{post.responses.length} 位邻居已响应</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {post.responses.map(r => (
              <Sticker key={r.userId || r.user_id} active={false} color="sky" style={{ minHeight: 28, padding: '4px 10px', pointerEvents: 'none', fontSize: 12 }}>
                {r.nickname || '邻居'}{r.building ? ` · ${formatResidence(r.building, '')}` : ''}
              </Sticker>
            ))}
          </div>
        </section>
      )}

      <section style={{ padding: '16px 16px 24px', borderTop: '1px solid color-mix(in srgb, var(--color-border) 70%, transparent)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 14 }}>
          回复 · {commentTotal}
        </div>
        {commentsLoading && <p role="status" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>评论加载中…</p>}
        {commentsError && !commentsNextError && (
          <div role="status" style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{comments.length ? '评论刷新失败，已保留当前回复' : '评论暂时无法加载'}</p>
            <Button variant="secondary" loading={commentsFetching} onClick={() => refetchComments()}>重试刷新评论</Button>
          </div>
        )}
        {comments.map(c => {
          const pinned = !!(c.pinned || c.pinnedAt || c.pinned_at)
          const replies = visibleReplies(c)
          const more = repliesMoreCount(c)
          const expanding = replyExpand[c.id]?.loading
          return (
            <div key={c.id} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--color-text)' }}>{c.nickname}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>{formatResidence(c.building, '')}</span>
                {pinned ? (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--color-primary)',
                    background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                    borderRadius: 999, padding: '2px 7px',
                  }}>
                    置顶
                  </span>
                ) : null}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  {isAuthor && (
                    <button type="button" onClick={() => togglePin(c)} style={linkBtn}>
                      {pinned ? '取消置顶' : '置顶'}
                    </button>
                  )}
                  <button type="button" onClick={() => startReply(c)} style={{ ...linkBtn, color: 'var(--color-primary)' }}>回复</button>
                  {user && user.id === c.user_id && (
                    <button type="button" onClick={() => setDeleteCommentId(c.id)} style={{ ...linkBtn, color: 'var(--color-danger)' }}>删除</button>
                  )}
                  {user && user.id !== c.user_id && (
                    <button type="button" onClick={() => setReportTarget({ type: 'comment', id: c.id })} style={linkBtn}>举报</button>
                  )}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{c.content}</p>

              {replies.length > 0 || repliesHasMore(c) ? (
                <div style={{ marginTop: 10, marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--color-border)' }}>
                  {replies.map((r) => (
                    <div key={r.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 2 }}>
                        <strong style={{ color: 'var(--color-text)' }}>{r.nickname}</strong>
                        <span style={{ color: 'var(--color-text-muted)' }}>{formatResidence(r.building, '')}</span>
                        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                          {user && user.id === (r.userId || r.user_id) && (
                            <button type="button" onClick={() => setDeleteReplyId(r.id)} style={{ ...linkBtn, color: 'var(--color-danger)' }}>删除</button>
                          )}
                          {user && user.id !== (r.userId || r.user_id) && (
                            <button type="button" onClick={() => setReportTarget({ type: 'reply', id: r.id })} style={linkBtn}>举报</button>
                          )}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{r.content}</p>
                    </div>
                  ))}
                  {repliesHasMore(c) ? (
                    <button
                      type="button"
                      disabled={expanding}
                      onClick={() => expandReplies(c)}
                      style={{ ...linkBtn, color: 'var(--color-primary)', paddingLeft: 0 }}
                    >
                      {expanding ? '加载中…' : (more > 0 ? `还有 ${more} 条回复` : '加载更多回复')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {comments.length > 0 && (
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: 8, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {commentsNextError ? (
              <div role="status">
                <p>更多评论加载失败</p>
                <Button variant="secondary" loading={isFetchingNextPage} disabled={commentsFetching && !isFetchingNextPage} onClick={() => fetchNextPage()}>重试加载评论</Button>
              </div>
            ) : isFetchingNextPage ? '加载中…' : ''}
          </div>
        )}
      </section>

      <div className="nh-page-chrome-bottom" style={composerBar}>
        {replyTo ? (
          <button
            type="button"
            onClick={() => { commentRevision.current++; setReplyTo(null) }}
            style={{
              ...linkBtn,
              flexShrink: 0,
              maxWidth: 88,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--color-primary)',
            }}
            title="取消回复"
          >
            取消
          </button>
        ) : null}
        <input
          ref={commentInputRef}
          value={comment}
          onChange={e => { commentRevision.current++; setComment(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
              e.preventDefault()
              sendComment()
            }
          }}
          placeholder={
            !user
              ? '登录后才能回复'
              : (replyTo ? `回复 @${replyTo.nickname}` : '说点什么…')
          }
          disabled={!user}
          style={{
            flex: 1, minWidth: 0, minHeight: 40, borderRadius: 999, border: '1.5px solid var(--color-border)',
            background: 'var(--color-surface)', color: 'var(--color-text)', padding: '0 14px', fontSize: 14, outline: 'none',
          }}
        />
        {user && comment.trim() ? (
          <Button
            type="button"
            onClick={sendComment}
            loading={commentMutation.isPending}
            style={{ borderRadius: 999, minWidth: 56, minHeight: 40, padding: '0 12px' }}
          >
            发送
          </Button>
        ) : null}
        <button
          type="button"
          aria-label={liked ? '取消点赞' : '点赞'}
          aria-pressed={liked}
          disabled={likeBusy}
          onClick={toggleLike}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            gap: 0, padding: '2px 6px', minWidth: 40,
            color: liked ? 'var(--color-primary)' : 'var(--color-text-muted)',
            fontSize: 11, fontWeight: 600,
          }}
        >
          <HeartIcon size={20} filled={liked} />
          {likeCount > 0 ? likeCount : '赞'}
        </button>
        {renderBottomPrimary()}
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
            <div style={{ position: 'absolute', top: 'calc(16px + var(--safe-top))', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 13 }}>
              {viewerIdx + 1} / {postImages.length}
            </div>
          )}
          <IconBtn ariaLabel="关闭" onClick={(e) => { e.stopPropagation(); setViewerIdx(null) }} style={{ position: 'absolute', top: 'calc(8px + var(--safe-top))', right: 8, color: '#fff' }}>
            <BackIcon size={22} />
          </IconBtn>
        </div>
      )}

      <Sheet open={authorMenuOpen} onClose={() => setAuthorMenuOpen(false)} title="管理帖子" heightVh={40}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {post.status === 'open' && (
            <>
              <Button
                type="button"
                variant="secondary"
                style={{ width: '100%' }}
                onClick={() => {
                  setAuthorMenuOpen(false)
                  navigate(`/edit/${id}`)
                }}
              >
                编辑
              </Button>
              <Button
                type="button"
                style={{ width: '100%' }}
                onClick={() => {
                  setAuthorMenuOpen(false)
                  setAdoptOpen(true)
                }}
                disabled={closeMutation.isPending}
              >
                标记完成
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            style={{ width: '100%', color: 'var(--color-danger)' }}
            onClick={() => {
              setAuthorMenuOpen(false)
              setDeleteOpen(true)
            }}
          >
            删除
          </Button>
        </div>
      </Sheet>

      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title="确定删除这条帖子吗?" heightVh={28}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>删除后不可恢复。</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setDeleteOpen(false)}>取消</Button>
          <Button type="button" loading={deleteMutation.isPending} style={{ flex: 1, background: 'var(--color-danger)' }} onClick={() => deleteMutation.mutate()}>删除</Button>
        </div>
      </Sheet>

      <Sheet open={!!deleteCommentId} onClose={() => setDeleteCommentId(null)} title="删除这条评论?" heightVh={28}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>删除后其下回复一并删除，且不可恢复。</p>
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

      <Sheet open={!!deleteReplyId} onClose={() => setDeleteReplyId(null)} title="删除这条回复?" heightVh={28}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>删除后不可恢复。</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setDeleteReplyId(null)}>取消</Button>
          <Button
            type="button"
            loading={deleteReplyMutation.isPending}
            style={{ flex: 1, background: 'var(--color-danger)' }}
            onClick={() => deleteReplyMutation.mutate(deleteReplyId)}
          >
            删除
          </Button>
        </div>
      </Sheet>

      <style>{`
        .nh-detail-cover::-webkit-scrollbar { display: none; }
      `}</style>
    </AppShell>
  )
}

function AdoptSheet({ open, onClose, postId, postType, onConfirm, submitting }) {
  const { user } = useAuth()
  const multi = postType === 'help'
  const [picks, setPicks] = useState({})
  const [inited, setInited] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['helperCandidates', postId, user?.id],
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
                {p.building ? <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}> · {formatResidence(p.building, '')}</span> : null}
              </div>
              {adopted && (
                <button type="button" onClick={() => toggleThank(p.id)} style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4, color: state === 'thank' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                  <HeartIcon size={14} />{state === 'thank' ? '已感谢' : '感谢'}
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
  const label = targetType === 'post' ? '帖子' : targetType === 'reply' ? '回复' : '评论'

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

const overlayHeader = {
  position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
  display: 'flex', alignItems: 'center', gap: 4,
  padding: 'calc(8px + var(--safe-top)) 10px 8px',
  // 工具区随封面滚动，保持透明，不在这个非吸顶段重复绘制视口柔光。
}
const composerBar = {
  position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0,
  width: '100%', maxWidth: 480, display: 'flex', gap: 6, alignItems: 'center',
  padding: '10px 12px calc(10px + var(--safe-bottom))',
  // 评论条外框由全局 chrome-bottom 类衔接安全区，输入框与按钮局部颜色保持。
  borderTop: '1px solid var(--color-border)',
  boxSizing: 'border-box', zIndex: 40,
}
const barPrimaryBtn = {
  borderRadius: 999,
  minHeight: 40,
  padding: '0 14px',
  flexShrink: 0,
  fontSize: 13,
  whiteSpace: 'nowrap',
}
const moreBtn = {
  border: 'none',
  background: 'var(--color-bg-accent)',
  borderRadius: 999,
  width: 40,
  height: 40,
  cursor: 'pointer',
  fontSize: 22,
  lineHeight: 1,
  color: 'var(--color-text)',
  flexShrink: 0,
}
const linkBtn = {
  border: 'none', background: 'transparent', color: 'var(--color-text-muted)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36, padding: '4px 8px',
}
const smBtn = { minHeight: 36, padding: '6px 12px', fontSize: 13 }
const metaLine = { fontSize: 13, color: 'var(--color-text-muted)' }
