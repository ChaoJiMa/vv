import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'
import BottomSheet from '../components/BottomSheet'

const WARM = '#EC6E33'
const ADMIN_QK = ['announcements-admin']
const PUBLIC_QK = ['announcements']

export default function AnnouncementsManage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = !!user && user.role === 'admin'
  const deniedOnce = useRef(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    if (!user || user.role === 'admin') return
    if (!deniedOnce.current) {
      deniedOnce.current = true
      toast.error('需要管理员权限')
    }
    navigate('/profile')
  }, [user, navigate])

  const { data, isLoading } = useQuery({
    queryKey: ADMIN_QK,
    queryFn: () => api.adminListAnnouncements(),
    enabled: isAdmin,
  })
  const list = data?.list ?? []

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ADMIN_QK })
    qc.invalidateQueries({ queryKey: PUBLIC_QK })
  }

  const createMut = useMutation({
    mutationFn: (body) => api.adminCreateAnnouncement(body),
    onSuccess: () => {
      toast.success('已新增')
      setFormOpen(false)
      invalidateAll()
    },
  })

  const updateMut = useMutation({
    mutationFn: (body) => api.adminUpdateAnnouncement(body),
    onSuccess: (_d, vars) => {
      if (vars.content !== undefined || vars.sort !== undefined) {
        toast.success('已保存')
        setFormOpen(false)
        setEditing(null)
      }
      invalidateAll()
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.adminDeleteAnnouncement(id),
    onSuccess: () => {
      toast.success('已删除')
      setDeleteTarget(null)
      invalidateAll()
    },
  })

  if (!isAdmin) {
    return (
      <Box sx={{ textAlign: 'center', py: 10 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={() => navigate('/profile')} aria-label="返回我的">
            <ArrowBackIcon />
          </IconButton>
          <Typography fontWeight={600} sx={{ flex: 1 }}>公告管理</Typography>
          <Button size="small" onClick={() => { setEditing(null); setFormOpen(true) }} sx={{ color: WARM, fontWeight: 600, minWidth: 0 }}>
            新增
          </Button>
        </Toolbar>
      </AppBar>

      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={24} /></Box>
      )}

      {!isLoading && list.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
          还没有公告，点右上角新增
        </Typography>
      )}

      {!isLoading && list.map((row) => (
        <Box key={row.id} sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'grey.100', bgcolor: 'background.paper' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
            <Typography variant="body2" sx={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {row.content}
            </Typography>
            <Chip
              label={row.enabled ? '启用' : '停用'}
              size="small"
              sx={{
                height: 22, fontSize: 12, flexShrink: 0,
                bgcolor: row.enabled ? 'rgba(236,110,51,0.08)' : 'grey.200',
                color: row.enabled ? WARM : 'text.secondary',
                fontWeight: 600,
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            排序 {row.sort ?? 0}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => { setEditing(row); setFormOpen(true) }} sx={{ minWidth: 0, px: 1, color: WARM }}>
              编辑
            </Button>
            <Button
              size="small"
              disabled={updateMut.isPending}
              onClick={() => updateMut.mutate({ id: row.id, enabled: row.enabled ? 0 : 1 })}
              sx={{ minWidth: 0, px: 1, color: 'text.secondary' }}
            >
              {row.enabled ? '停用' : '启用'}
            </Button>
            <Button size="small" onClick={() => setDeleteTarget(row)} sx={{ minWidth: 0, px: 1, color: 'error.main' }}>
              删除
            </Button>
          </Box>
        </Box>
      ))}

      <BottomSheet
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        title={editing ? '编辑公告' : '新增公告'}
        heightVh={48}
      >
        <AnnouncementForm
          key={editing?.id || 'new'}
          initial={editing}
          pending={createMut.isPending || updateMut.isPending}
          onSubmit={(body) => {
            if (editing) updateMut.mutate({ id: editing.id, ...body })
            else createMut.mutate(body)
          }}
        />
      </BottomSheet>

      <BottomSheet open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="确定删除这条公告吗?" heightVh={28}>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
          <Button fullWidth variant="outlined" color="inherit" onClick={() => setDeleteTarget(null)} sx={{ py: 1.2 }}>取消</Button>
          <Button
            fullWidth
            variant="contained"
            color="error"
            disableElevation
            disabled={deleteMut.isPending}
            onClick={() => deleteMut.mutate(deleteTarget.id)}
            sx={{ py: 1.2 }}
          >
            删除
          </Button>
        </Box>
      </BottomSheet>
    </Box>
  )
}

function AnnouncementForm({ initial, pending, onSubmit }) {
  const [content, setContent] = useState(initial?.content || '')
  const [sort, setSort] = useState(initial?.sort != null ? String(initial.sort) : '')

  const submit = (e) => {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) {
      toast.error('公告内容不能为空')
      return
    }
    if (trimmed.length > 200) {
      toast.error('公告内容不能超过200字')
      return
    }
    const body = { content: trimmed }
    if (sort !== '') {
      const n = Number(sort)
      if (!Number.isInteger(n)) {
        toast.error('排序须为整数')
        return
      }
      body.sort = n
    }
    onSubmit(body)
  }

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      <TextField
        label="公告内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        multiline
        minRows={3}
        fullWidth
        inputProps={{ maxLength: 200 }}
        helperText={`${content.length}/200`}
      />
      <TextField
        label="排序(可选,越大越靠前)"
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        fullWidth
        type="number"
      />
      <Button type="submit" variant="contained" disableElevation disabled={pending} sx={{ py: 1.2, bgcolor: WARM, '&:hover': { bgcolor: '#D85F26' } }}>
        {pending ? '提交中…' : (initial ? '保存' : '新增')}
      </Button>
    </Box>
  )
}
