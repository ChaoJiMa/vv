import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

export default function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [comment, setComment] = useState('')

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

  const commentMutation = useMutation({
    mutationFn: () => api.addComment(id, comment),
    // 乐观更新:先把评论插入本地缓存,失败再回滚
    onMutate: async () => {
      const text = comment
      await qc.cancelQueries({ queryKey: ['post', id] })
      const prev = qc.getQueryData(['post', id])
      qc.setQueryData(['post', id], (old) => old ? {
        ...old,
        comments: [
          ...(old.comments || []),
          { id: `tmp-${Date.now()}`, content: text, nickname: user?.nickname || '我', building: user?.building || '', _optimistic: true },
        ],
      } : old)
      setComment('')
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['post', id], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['post', id] }),
  })

  const closeMutation = useMutation({
    mutationFn: () => api.closePost(id),
    // 乐观更新:立即置为已完成
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['post', id] })
      const prev = qc.getQueryData(['post', id])
      qc.setQueryData(['post', id], (old) => old ? { ...old, status: 'closed' } : old)
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['post', id], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['post', id] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
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

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId) => api.deleteComment(commentId),
    // 乐观移除:先从缓存删掉,失败回滚
    onMutate: async (commentId) => {
      await qc.cancelQueries({ queryKey: ['post', id] })
      const prev = qc.getQueryData(['post', id])
      qc.setQueryData(['post', id], (old) => old ? {
        ...old,
        comments: (old.comments || []).filter(c => c.id !== commentId),
      } : old)
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['post', id], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['post', id] }),
  })

  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress size={24} /></Box>
  }
  if (!post) {
    return <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>帖子不存在</Box>
  }

  const menu = menuMap[post.type]

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
                    <Button size="small" color="primary" onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}>
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
            {/* 非本人帖子:私信发帖人。来源帖 id 一并带上 */}
            {user && user.id !== post.user_id && (
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={() => navigate(`/messages/${post.user_id}`, { state: { postId: id } })}
              >
                私信 TA
              </Button>
            )}
          </Box>
        </Box>

        {/* 评论列表 */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            共 {post.comments?.length || 0} 条回复
          </Typography>
          {post.comments?.map(c => (
            <Box key={c.id} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="caption" fontWeight={500} color="text.primary">{c.nickname}</Typography>
                <Typography variant="caption" color="text.disabled">{c.building || ''}</Typography>
                {user && user.id === c.user_id && !c._optimistic && (
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
            onClick={() => user ? commentMutation.mutate() : navigate('/login')}
            disabled={user && (!comment.trim() || commentMutation.isPending)}
            sx={{ borderRadius: 5, minWidth: 64 }}
          >
            发送
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
