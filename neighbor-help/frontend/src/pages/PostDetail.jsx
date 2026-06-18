import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import InputBase from '@mui/material/InputBase'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'
import BottomSheet from '../components/BottomSheet'

const WARM = '#EC6E33'

// 响应按钮文案随分类变化;拼单(group)不支持响应
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
  // 从个人页「完成」入口进来时带 state.openAdopt,加载后自动打开采纳抽屉(统一走采纳流程)
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [adoptAuto, setAdoptAuto] = useState(false)

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const { data: post, isLoading } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
  })

  // 评论分页:独立 useInfiniteQuery,按时间正序,触底加载更多
  const {
    data: commentData, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['comments', id],
    queryFn: ({ pageParam }) => api.getComments(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const comments = commentData?.pages.flatMap(p => p.list) ?? []
  const commentTotal = commentData?.pages?.[0]?.total ?? post?.comment_count ?? 0

  const commentMutation = useMutation({
    // content 通过 variables 显式传入,不依赖闭包:onMutate 里会 setComment('') 清空输入,
    // 若 mutationFn 读闭包的 comment,await 让出后会读到已清空的空串,导致提交空内容。
    mutationFn: (text) => api.addComment(id, text),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['comments', id] })
      qc.invalidateQueries({ queryKey: ['post', id] }) // 刷新 comment_count
    },
  })

  const closeMutation = useMutation({
    // helpers: [{ helperId, thanked }] 采纳的帮助者,可为空(纯完成)
    mutationFn: (helpers) => api.closePost(id, helpers),
    onSuccess: () => {
      setAdoptOpen(false)
      toast.success('已完成')
      qc.invalidateQueries({ queryKey: ['post', id] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myStats'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.removeQueries({ queryKey: ['post', id] })
      navigate('/')
    },
  })

  // 响应帖子:记一条响应后跳到与发帖人的私信
  const respondMutation = useMutation({
    mutationFn: () => api.respondPost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post', id] })
      navigate(`/messages/${post.user_id}`, { state: { postId: id } })
    },
  })

  // 取消响应:从响应者列表移除自己(不跳转)
  const unrespondMutation = useMutation({
    mutationFn: () => api.unrespondPost(id),
    onSuccess: () => {
      toast.success('已取消响应')
      qc.invalidateQueries({ queryKey: ['post', id] })
    },
  })

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId) => api.deleteComment(commentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', id] })
      qc.invalidateQueries({ queryKey: ['post', id] })
    },
  })

  // 触底自动加载更多评论
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
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress size={24} /></Box>
  }
  if (!post) {
    return <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>帖子不存在</Box>
  }

  const menu = menuMap[post.type]

  // 自动打开采纳抽屉:仅当来源带 openAdopt、本人帖、未完成,且只触发一次
  if (!adoptAuto && location.state?.openAdopt) {
    if (user && user.id === post.user_id && post.status === 'open') {
      setAdoptOpen(true)
    }
    setAdoptAuto(true)
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh', pb: 12 }}>
        {/* 头部 */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ gap: 1 }}>
            <IconButton edge="start" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
            <Typography fontWeight={500}>{menu?.label || post.type}</Typography>
            {post.status === 'closed' && (
              <Chip label="已完成" size="small" sx={{ ml: 'auto', height: 22 }} />
            )}
          </Toolbar>
        </AppBar>

        {/* 帖子内容 */}
        <Box sx={{ px: 2, py: 2, borderBottom: 1, borderColor: 'grey.100' }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>{post.title}</Typography>
          {post.content && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>{post.content}</Typography>
          )}
          {/* 位置 / 联系方式 */}
          {(post.location || post.contact) && (
            <Box sx={{ mb: 1.5 }}>
              {post.location && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>📍 {post.location}</Typography>
              )}
              {post.contact && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>📞 {post.contact}</Typography>
              )}
            </Box>
          )}
          {/* 已采纳的帮助者(完成帖) */}
          {post.helpers?.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary">感谢:</Typography>
              {post.helpers.map(h => (
                <Chip
                  key={h.helper_id}
                  label={`${h.thanked ? '🙏 ' : ''}${h.nickname || '邻居'}`}
                  size="small"
                  sx={{ height: 22, fontSize: 12, bgcolor: 'rgba(236,110,51,0.1)', color: WARM }}
                />
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              {post.building || ''}{post.unit || ''}邻居 · {post.nickname}
            </Typography>
            {user && user.id === post.user_id && (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {post.status === 'open' && (
                  <>
                    <Button size="small" color="primary" onClick={() => navigate(`/edit/${id}`)}>
                      编辑
                    </Button>
                    <Button size="small" color="primary" onClick={() => setAdoptOpen(true)} disabled={closeMutation.isPending}>
                      标记完成
                    </Button>
                  </>
                )}
                <Button
                  size="small"
                  color="error"
                  onClick={() => { if (window.confirm('确定删除这条帖子吗?')) deleteMutation.mutate() }}
                  disabled={deleteMutation.isPending}
                >
                  删除
                </Button>
              </Box>
            )}
            {/* 非本人帖子 */}
            {user && user.id !== post.user_id && (
              RESPOND_LABEL[post.type] ? (
                // 可响应类型:已响应显示态;未响应点击=记响应+跳私信
                post.myResponded ? (
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      onClick={() => navigate(`/messages/${post.user_id}`, { state: { postId: id } })}
                      sx={{ color: 'text.secondary' }}
                    >
                      私信
                    </Button>
                    {post.status === 'open' && (
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => unrespondMutation.mutate()}
                        disabled={unrespondMutation.isPending}
                        sx={{ color: 'text.disabled', minWidth: 0 }}
                      >
                        取消响应
                      </Button>
                    )}
                  </Box>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    onClick={() => respondMutation.mutate()}
                    disabled={respondMutation.isPending || post.status === 'closed'}
                    sx={{ bgcolor: WARM, '&:hover': { bgcolor: '#D85F26' } }}
                  >
                    {RESPOND_LABEL[post.type]}
                  </Button>
                )
              ) : (
                // 其它类型(拼单):私信发帖人
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  onClick={() => navigate(`/messages/${post.user_id}`, { state: { postId: id } })}
                >
                  私信 TA
                </Button>
              )
            )}
          </Box>
        </Box>

        {/* 响应者列表(公开):可响应类型且有人响应时显示 */}
        {RESPOND_LABEL[post.type] && post.responses?.length > 0 && (
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'grey.100', bgcolor: 'grey.50' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {post.responses.length} 位邻居已响应
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {post.responses.map(r => (
                <Chip
                  key={r.user_id}
                  label={`${r.nickname || '邻居'}${r.building ? ` · ${r.building}` : ''}`}
                  size="small"
                  sx={{ height: 24, fontSize: 12 }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* 评论列表 */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            共 {commentTotal} 条回复
          </Typography>
          {comments.map(c => (
            <Box key={c.id} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="caption" fontWeight={500} color="text.primary">{c.nickname}</Typography>
                <Typography variant="caption" color="text.disabled">{c.building || ''}</Typography>
                {user && user.id === c.user_id && (
                  <Typography
                    variant="caption"
                    color="error"
                    onClick={() => { if (window.confirm('删除这条评论?')) deleteCommentMutation.mutate(c.id) }}
                    sx={{ ml: 'auto', cursor: 'pointer' }}
                  >
                    删除
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary">{c.content}</Typography>
            </Box>
          ))}
          {/* 触底加载更多评论 */}
          {comments.length > 0 && (
            <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 1, color: 'text.disabled' }}>
              {isFetchingNextPage && <CircularProgress size={18} />}
            </Box>
          )}
        </Box>

        {/* 评论输入框 */}
        <Box sx={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, bgcolor: 'background.paper', borderTop: 1, borderColor: 'grey.100', px: 2, py: 1.5, display: 'flex', gap: 1 }}>
          <InputBase
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={user ? '写下你的回复...' : '登录后才能回复'}
            disabled={!user}
            sx={{ flex: 1, bgcolor: 'grey.100', borderRadius: 5, px: 2, py: 0.5, fontSize: 14 }}
          />
          <Button
            variant="contained"
            color="primary"
            onClick={() => user ? commentMutation.mutate(comment.trim()) : navigate('/login')}
            disabled={user && (!comment.trim() || commentMutation.isPending)}
            sx={{ borderRadius: 5, minWidth: 64 }}
          >
            发送
          </Button>
        </Box>
      </Box>

      {/* 完成 + 采纳帮助者抽屉 */}
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
    </Box>
  )
}

// ===== 完成并采纳帮助者 =====
// 候选人 = 本帖响应者(点过"我要帮忙/我想要/这是我的"的人)∪ 评论过的邻居。
// 求助(help):可多选,默认全选(采纳即默认感谢)。
// 闲置/失物(idle/lost):单选一人,默认不选(物品/失物归属唯一)。
// 也可谁都不选直接完成。
function AdoptSheet({ open, onClose, postId, postType, onConfirm, submitting }) {
  const multi = postType === 'help' // 求助多选,其余单选
  // picks: { [helperId]: true(采纳) | 'thank'(采纳并感谢) }
  const [picks, setPicks] = useState({})
  const [inited, setInited] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['helperCandidates', postId],
    queryFn: () => api.getHelperCandidates(postId),
    enabled: open,
  })
  const candidates = data?.candidates ?? []

  // 候选人到达后初始化默认选择(渲染期派生,避免 effect 内 setState):
  // 求助默认全选并感谢;单选类默认不选。
  if (!inited && !isLoading) {
    if (multi && candidates.length > 0) {
      const all = {}
      candidates.forEach(p => { all[p.id] = 'thank' })
      setPicks(all)
    }
    setInited(true)
  }

  // 采纳开关:多选可任意切换;单选则点选某人时清掉其他人
  const toggleAdopt = (uid) => {
    setPicks(prev => {
      if (multi) {
        const next = { ...prev }
        if (next[uid]) delete next[uid]
        else next[uid] = 'thank' // 采纳默认带感谢
        return next
      }
      // 单选:已选则取消,否则只选这一个
      return prev[uid] ? {} : { [uid]: 'thank' }
    })
  }
  // 感谢开关:采纳后才可切;true(仅采纳) <-> 'thank'(采纳并感谢)
  const toggleThank = (uid) => {
    setPicks(prev => {
      if (!prev[uid]) return prev
      return { ...prev, [uid]: prev[uid] === 'thank' ? true : 'thank' }
    })
  }

  const submit = () => {
    const helpers = Object.entries(picks).map(([helperId, v]) => ({ helperId, thanked: v === 'thank' }))
    onConfirm(helpers)
  }

  const pickedCount = Object.keys(picks).length

  return (
    <BottomSheet open={open} onClose={onClose} title="完成并感谢帮助你的邻居" heightVh={62}>
      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={22} /></Box>
      )}

      {!isLoading && candidates.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          还没有邻居响应。可直接完成。
        </Typography>
      )}

      {!isLoading && candidates.length > 0 && (
        <Typography variant="caption" color="text.disabled" sx={{ pb: 1, flexShrink: 0 }}>
          {multi ? '可采纳多位帮你的邻居' : '只能采纳一位(物品/失物归属唯一)'}
        </Typography>
      )}

      {/* 候选人列表 */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {candidates.map(p => {
          const state = picks[p.id]   // undefined | true | 'thank'
          const adopted = !!state
          return (
            <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, borderBottom: 1, borderColor: 'grey.100' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.nickname}
                  {p.building ? <Typography component="span" variant="caption" color="text.disabled"> · {p.building}</Typography> : null}
                </Typography>
              </Box>
              {/* 感谢:仅采纳后可点 */}
              {adopted && (
                <Button
                  size="small"
                  onClick={() => toggleThank(p.id)}
                  sx={{ minWidth: 0, px: 1, fontSize: 12, color: state === 'thank' ? WARM : 'text.disabled' }}
                >
                  {state === 'thank' ? '🙏 已感谢' : '🙏 感谢'}
                </Button>
              )}
              {/* 采纳开关 */}
              <Button
                size="small"
                variant={adopted ? 'contained' : 'outlined'}
                disableElevation
                onClick={() => toggleAdopt(p.id)}
                sx={adopted
                  ? { minWidth: 64, bgcolor: WARM, '&:hover': { bgcolor: '#D85F26' } }
                  : { minWidth: 64, borderColor: WARM, color: WARM, '&:hover': { borderColor: '#D85F26', bgcolor: 'transparent' } }}
              >
                {adopted ? '已采纳' : '采纳'}
              </Button>
            </Box>
          )
        })}
      </Box>

      {/* 底部:确认完成 */}
      <Box sx={{ pt: 1.5, flexShrink: 0 }}>
        <Button
          fullWidth
          variant="contained"
          disableElevation
          onClick={submit}
          disabled={submitting}
          sx={{ py: 1.3, bgcolor: WARM, '&:hover': { bgcolor: '#D85F26' } }}
        >
          {pickedCount > 0 ? `完成并采纳 ${pickedCount} 位邻居` : '直接完成(不采纳)'}
        </Button>
      </Box>
    </BottomSheet>
  )
}
