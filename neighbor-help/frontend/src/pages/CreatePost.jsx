import { useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Collapse from '@mui/material/Collapse'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'

const WARM = '#EC6E33'
const WARM_DARK = '#D85F26'

// 标题占位文案随分类变化
const TITLE_PLACEHOLDER = {
  help: '输入你的需求标题',
  idle: '输入物品名称',
  lost: '输入物品名称',
  group: '输入拼单主题',
}

export default function CreatePost() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { id } = useParams() // 有 id 即编辑模式
  const isEdit = !!id

  // 非编辑模式下,支持从首页入口/空态引导带预选类型(location.state.type)
  const [type, setType] = useState(() => (!id && location.state?.type) || '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  // 位置默认带入资料的楼栋单元,可手动改
  const [postLocation, setPostLocation] = useState(() => [user?.building, user?.unit].filter(Boolean).join(' '))
  const [moreOpen, setMoreOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

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
    setContact(editing.contact || '')
    setPostLocation(editing.location || '')
    if (editing.contact) setMoreOpen(true)
    setFilledId(id)
  }

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api.updatePost(id, { type, title, content, contact, location: postLocation })
      : api.createPost({ type, title, content, contact, location: postLocation }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['post', id] })
      navigate(`/post/${data.id}`, { replace: true })
    },
  })

  const canSubmit = type && title.trim() && content.trim()
  // 有草稿(填了任意内容)时,取消需二次确认
  const hasDraft = !isEdit && (type || title.trim() || content.trim() || contact.trim())

  const handleCancel = () => {
    if (hasDraft) setCancelOpen(true)
    else navigate(-1)
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh', pb: 'calc(80px + env(safe-area-inset-bottom))' }}>
        {/* 顶部导航:取消 / 居中标题 / 提交(未填必填项置灰) */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Button color="inherit" onClick={handleCancel} sx={{ color: 'text.secondary', minWidth: 48 }}>取消</Button>
            <Typography fontWeight={600}>{isEdit ? '编辑' : '发布'}</Typography>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
              sx={{ minWidth: 48, color: WARM, fontWeight: 600, '&.Mui-disabled': { color: 'grey.300' } }}
            >
              {isEdit ? '保存' : '发布'}
            </Button>
          </Toolbar>
        </AppBar>

        <Box sx={{ px: 2, py: 2 }}>
          {/* 选择分类:2×2 网格,选中边框品牌色高亮 */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>选择分类</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 3 }}>
            {menus.map(t => {
              const active = type === t.value
              return (
                <Box
                  key={t.value}
                  onClick={() => setType(t.value)}
                  sx={{
                    p: 1.5, borderRadius: 2, border: 2, cursor: 'pointer',
                    borderColor: active ? WARM : 'grey.200',
                    bgcolor: active ? 'rgba(236,110,51,0.06)' : 'transparent',
                    transition: 'all .15s',
                  }}
                >
                  <Typography sx={{ fontSize: 20 }}>{t.icon}</Typography>
                  <Typography variant="body2" fontWeight={500} sx={{ mt: 0.5, color: active ? WARM_DARK : 'text.primary' }}>{t.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{t.desc}</Typography>
                </Box>
              )
            })}
          </Box>

          {/* 标题:必填,占位随分类变化 */}
          <TextField
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={TITLE_PLACEHOLDER[type] || '输入标题'}
            inputProps={{ maxLength: 100 }}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />

          {/* 详细描述:必填,多行可拖动 */}
          <TextField
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="详细描述你的需求..."
            multiline
            minRows={4}
            inputProps={{ maxLength: 5000 }}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />

          {/* 更多选项(折叠):联系方式 + 位置 */}
          <Box
            onClick={() => setMoreOpen(o => !o)}
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', py: 1, color: 'text.secondary' }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>更多选项</Typography>
            <ExpandMoreIcon sx={{ transition: 'transform .2s', transform: moreOpen ? 'rotate(180deg)' : 'none' }} />
          </Box>
          <Collapse in={moreOpen}>
            <Box sx={{ pt: 1 }}>
              <TextField
                value={contact}
                onChange={e => setContact(e.target.value)}
                label="联系方式"
                placeholder="微信号 / 手机号(可选)"
                inputProps={{ maxLength: 50 }}
                fullWidth
                size="small"
                sx={{ mb: 2 }}
              />
              <TextField
                value={postLocation}
                onChange={e => setPostLocation(e.target.value)}
                label="位置"
                placeholder="如 3 栋 2 单元"
                inputProps={{ maxLength: 50 }}
                fullWidth
                size="small"
              />
            </Box>
          </Collapse>

          {/* 底部限流提示 */}
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 3, textAlign: 'center' }}>
            为保证社区秩序,1 分钟最多发布 5 条
          </Typography>
        </Box>
      </Box>

      {/* 取消二次确认:有草稿时 */}
      <BottomSheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="放弃这次发布?" heightVh={28}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          你填写的内容尚未发布,离开将不会保留。
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 'auto' }}>
          <Button fullWidth onClick={() => setCancelOpen(false)} color="inherit" variant="outlined" sx={{ py: 1.2 }}>继续编辑</Button>
          <Button fullWidth onClick={() => navigate(-1)} color="error" variant="contained" disableElevation sx={{ py: 1.2 }}>放弃</Button>
        </Box>
      </BottomSheet>

      <BottomNav />
    </Box>
  )
}
