import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Chip from '@mui/material/Chip'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'

export default function Profile() {
  const navigate = useNavigate()
  const { user, setUser, logout } = useAuth()

  if (!user) {
    return (
      <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>
        <Typography variant="body2" sx={{ mb: 2 }}>请先登录</Typography>
        <Button variant="contained" onClick={() => navigate('/login')}>去登录</Button>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'background.paper', minHeight: '100vh' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar sx={{ gap: 1 }}>
            <IconButton edge="start" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
            <Typography fontWeight={500}>个人资料</Typography>
          </Toolbar>
        </AppBar>

        {/* key=user.id 保证用户信息到达/切换时子组件用最新值重新初始化,无需 effect 同步 */}
        <ProfileForm key={user.id} user={user} setUser={setUser} onSaved={() => navigate(-1)} />

        <Divider sx={{ my: 1 }} />

        <MyPosts navigate={navigate} />

        <Divider sx={{ my: 1 }} />

        {user.username && <PasswordSection />}

        <Box sx={{ px: 2, pb: 3 }}>
          <Button
            variant="outlined"
            color="inherit"
            fullWidth
            onClick={() => { logout(); navigate('/') }}
            sx={{ py: 1.2, color: 'text.secondary' }}
          >
            退出登录
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

// ===== 资料表单 =====
function ProfileForm({ user, setUser, onSaved }) {
  const [nickname, setNickname] = useState(user.nickname || '')
  const [building, setBuilding] = useState(user.building || '')
  const [unit, setUnit] = useState(user.unit || '')

  const mutation = useMutation({
    mutationFn: () => api.updateMe({ nickname: nickname.trim(), building: building.trim(), unit: unit.trim() }),
    onSuccess: () => {
      // 同步更新本地登录态,避免回到首页仍显示旧资料
      setUser(prev => ({ ...prev, nickname: nickname.trim(), building: building.trim(), unit: unit.trim() }))
      toast.success('保存成功')
      onSaved()
    },
  })

  return (
    <Box sx={{ px: 2, py: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>用户名</Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>{user.username || '微信用户'}</Typography>

      <TextField label="昵称" value={nickname} onChange={e => setNickname(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField label="楼栋" value={building} onChange={e => setBuilding(e.target.value)} placeholder="如 3 栋" size="small" sx={{ flex: 1 }} />
        <TextField label="单元/门牌" value={unit} onChange={e => setUnit(e.target.value)} placeholder="如 2 单元 501" size="small" sx={{ flex: 1 }} />
      </Box>

      <Button variant="contained" color="primary" fullWidth onClick={() => mutation.mutate()} disabled={mutation.isPending} sx={{ py: 1.2 }}>
        保存资料
      </Button>
    </Box>
  )
}

// ===== 修改密码 =====
function PasswordSection() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.changePassword({ oldPassword, newPassword }),
    onSuccess: (data) => {
      // 后端改密码会吊销旧 token 并下发新 token,需替换本地的,否则后续请求会被判为已失效
      if (data?.token) api.setToken(data.token)
      toast.success('密码修改成功')
      setOldPassword(''); setNewPassword(''); setConfirm('')
    },
  })

  const handleSubmit = () => {
    if (newPassword !== confirm) {
      toast.error('两次输入的新密码不一致')
      return
    }
    mutation.mutate()
  }

  const canSubmit = oldPassword && newPassword && confirm && !mutation.isPending

  return (
    <Box sx={{ px: 2, py: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>修改密码</Typography>
      <TextField type="password" label="旧密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <TextField type="password" label="新密码(至少6位)" value={newPassword} onChange={e => setNewPassword(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <TextField type="password" label="确认新密码" value={confirm} onChange={e => setConfirm(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <Button variant="outlined" color="primary" fullWidth onClick={handleSubmit} disabled={!canSubmit} sx={{ py: 1.2 }}>
        修改密码
      </Button>
    </Box>
  )
}

// ===== 我发布的帖子 =====
function MyPosts({ navigate }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('') // '' 全部 | 'open' 进行中 | 'closed' 已完成

  // 只取第一页;状态筛选入 queryKey
  const { data, isLoading } = useQuery({
    queryKey: ['myPosts', status],
    queryFn: () => api.getMyPosts(1, status),
  })
  const list = data?.list ?? []

  // 快捷标记完成:成功后刷新我的帖子(各状态)与首页列表
  const closeMutation = useMutation({
    mutationFn: (id) => api.closePost(id),
    onSuccess: () => {
      toast.success('已标记完成')
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.invalidateQueries({ queryKey: ['posts'] })
    },
  })

  return (
    <Box sx={{ px: 2, py: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        我发布的{data?.total ? `（${data.total}）` : ''}
      </Typography>

      {/* 状态筛选 */}
      <Tabs
        value={status}
        onChange={(_, v) => setStatus(v)}
        sx={{ minHeight: 36, mb: 1, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
      >
        <Tab label="全部" value="" />
        <Tab label="进行中" value="open" />
        <Tab label="已完成" value="closed" />
      </Tabs>

      {isLoading && (
        <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={20} /></Box>
      )}
      {!isLoading && list.length === 0 && (
        <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
          {status === 'open' ? '没有进行中的帖子' : status === 'closed' ? '没有已完成的帖子' : '还没有发布过帖子'}
        </Typography>
      )}
      {list.map(p => (
        <Box
          key={p.id}
          onClick={() => navigate(`/post/${p.id}`)}
          sx={{ py: 1.5, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="body2" fontWeight={500} sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.title}
            </Typography>
            {p.status === 'closed' && <Chip label="已完成" size="small" sx={{ height: 20, fontSize: 12 }} />}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              {p.comment_count > 0 ? `💬 ${p.comment_count} 条回复` : '暂无回复'}
            </Typography>
            {/* 进行中的帖子可在此快捷标记完成,点击不冒泡到跳转 */}
            {p.status === 'open' && (
              <Button
                size="small"
                color="primary"
                onClick={(e) => { e.stopPropagation(); closeMutation.mutate(p.id) }}
                disabled={closeMutation.isPending}
                sx={{ minWidth: 0, py: 0, px: 1, fontSize: 12 }}
              >
                标记完成
              </Button>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
