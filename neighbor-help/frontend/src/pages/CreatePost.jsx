import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import { api } from '../api'

export default function CreatePost() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams() // 有 id 即编辑模式
  const isEdit = !!id
  const [type, setType] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  // 类型菜单由后端返回
  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })

  // 编辑模式:拉取原帖详情用于预填
  const { data: editing } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
    enabled: isEdit,
  })

  // 详情到达后填充表单一次。用渲染期派生(记录已填充的 id),避免在 effect 里 setState。
  const [filledId, setFilledId] = useState(null)
  if (editing && filledId !== id) {
    setType(editing.type || '')
    setTitle(editing.title || '')
    setContent(editing.content || '')
    setFilledId(id)
  }

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api.updatePost(id, { type, title, content })
      : api.createPost({ type, title, content }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['post', id] })
      navigate(`/post/${data.id}`)
    },
  })

  const canSubmit = type && title.trim()

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh' }}>
        {/* 头部 */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Button color="inherit" onClick={() => navigate(-1)} sx={{ color: 'text.secondary' }}>取消</Button>
            <Typography fontWeight={500}>{isEdit ? '编辑帖子' : '发布帖子'}</Typography>
            <Button
              color="primary"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
            >
              {isEdit ? '保存' : '发布'}
            </Button>
          </Toolbar>
        </AppBar>

        <Box sx={{ px: 2, py: 2 }}>
          {/* 类型选择 */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>选择类型</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 3 }}>
            {menus.map(t => (
              <Box
                key={t.value}
                onClick={() => setType(t.value)}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: 2,
                  borderColor: type === t.value ? 'primary.main' : 'grey.200',
                  bgcolor: type === t.value ? 'primary.50' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <Typography sx={{ fontSize: 20 }}>{t.icon}</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ mt: 0.5 }}>{t.label}</Typography>
                <Typography variant="caption" color="text.secondary">{t.desc}</Typography>
              </Box>
            ))}
          </Box>

          {/* 标题 */}
          <TextField
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="标题（必填，简洁描述你的需求）"
            inputProps={{ maxLength: 50 }}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />

          {/* 详情 */}
          <TextField
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="补充详情（可选）"
            multiline
            rows={5}
            fullWidth
            size="small"
          />
        </Box>
      </Box>
    </Box>
  )
}
