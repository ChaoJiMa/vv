import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Avatar from '@mui/material/Avatar'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import CircularProgress from '@mui/material/CircularProgress'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'
import BottomNav from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'

const WARM = '#EC6E33'

export default function Profile() {
  const navigate = useNavigate()
  const { user, setUser, logout } = useAuth()
  const [editOpen, setEditOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)

  // 个人统计:帮助了 X 次 · 获得帮助 X 次
  const { data: stats } = useQuery({
    queryKey: ['myStats'],
    queryFn: () => api.getMyStats(),
    enabled: !!user,
  })

  if (!user) {
    return (
      <Box sx={{ textAlign: 'center', py: 10, color: 'text.disabled' }}>
        <Typography variant="body2" sx={{ mb: 2 }}>请先登录</Typography>
        <Button variant="contained" onClick={() => navigate('/login')}>去登录</Button>
      </Box>
    )
  }

  const location = [user.building, user.unit].filter(Boolean).join(' ')

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', bgcolor: 'grey.50', minHeight: '100vh', pb: 'calc(72px + env(safe-area-inset-bottom))' }}>
        {/* 顶部:仅标题 */}
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'grey.100' }}>
          <Toolbar>
            <Typography fontWeight={600}>我的</Typography>
          </Toolbar>
        </AppBar>

        {/* 个人信息区:点击进入编辑资料 */}
        <Box
          onClick={() => setEditOpen(true)}
          sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 3, bgcolor: 'background.paper', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
        >
          <Avatar src={user.avatar || undefined} sx={{ width: 60, height: 60, bgcolor: WARM, fontSize: 26 }}>
            {user.avatar ? null : (user.nickname?.[0] || user.username?.[0] || '邻')}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.nickname || user.username || '邻居'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {location || '未设置楼栋单元'}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: WARM, fontWeight: 500 }}>
              帮助了 {stats?.helped ?? 0} 次 · 获得帮助 {stats?.received ?? 0} 次
            </Typography>
          </Box>
          <ChevronRightIcon sx={{ color: 'text.disabled' }} />
        </Box>

        {/* 功能菜单 */}
        <Box sx={{ mt: 1.5, bgcolor: 'background.paper' }}>
          <MenuRow label="编辑资料" onClick={() => setEditOpen(true)} />
          {user.username && <MenuRow label="修改密码" onClick={() => setPwdOpen(true)} />}
        </Box>

        {/* 我的帖子 */}
        <Box sx={{ mt: 1.5, bgcolor: 'background.paper' }}>
          <MyPosts navigate={navigate} />
        </Box>

        {/* 退出登录:红色居中,二次确认 */}
        <Box sx={{ px: 2, py: 3 }}>
          <Button
            fullWidth
            onClick={() => setLogoutOpen(true)}
            sx={{ py: 1.2, color: 'error.main', fontWeight: 500 }}
          >
            退出登录
          </Button>
        </Box>
      </Box>

      {/* 编辑资料:底部抽屉 */}
      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title="编辑资料" heightVh={56}>
        {/* key 保证每次打开用最新 user 初始化 */}
        <EditProfileForm key={user.id + String(editOpen)} user={user} setUser={setUser} onDone={() => setEditOpen(false)} />
      </BottomSheet>

      {/* 修改密码:底部抽屉 */}
      <BottomSheet open={pwdOpen} onClose={() => setPwdOpen(false)} title="修改密码" heightVh={52}>
        <PasswordForm onDone={() => setPwdOpen(false)} />
      </BottomSheet>

      {/* 退出二次确认:底部抽屉 */}
      <BottomSheet open={logoutOpen} onClose={() => setLogoutOpen(false)} title="确定退出登录吗?" heightVh={28}>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
          <Button fullWidth onClick={() => setLogoutOpen(false)} color="inherit" variant="outlined" sx={{ py: 1.2 }}>取消</Button>
          <Button fullWidth onClick={() => { logout(); navigate('/login') }} color="error" variant="contained" disableElevation sx={{ py: 1.2 }}>退出</Button>
        </Box>
      </BottomSheet>

      <BottomNav />
    </Box>
  )
}

// ===== 功能菜单行 =====
function MenuRow({ label, onClick }) {
  return (
    <Box
      onClick={onClick}
      sx={{ display: 'flex', alignItems: 'center', px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'grey.100', cursor: 'pointer', '&:active': { bgcolor: 'grey.50' } }}
    >
      <Typography variant="body2" sx={{ flex: 1 }}>{label}</Typography>
      <ChevronRightIcon sx={{ color: 'text.disabled', fontSize: 20 }} />
    </Box>
  )
}

// ===== 资料表单(弹窗内)=====
function EditProfileForm({ user, setUser, onDone }) {
  const [nickname, setNickname] = useState(user.nickname || '')
  const [building, setBuilding] = useState(user.building || '')
  const [unit, setUnit] = useState(user.unit || '')

  const mutation = useMutation({
    mutationFn: () => api.updateMe({ nickname: nickname.trim(), building: building.trim(), unit: unit.trim() }),
    onSuccess: () => {
      setUser(prev => ({ ...prev, nickname: nickname.trim(), building: building.trim(), unit: unit.trim() }))
      toast.success('保存成功')
      onDone()
    },
  })

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>用户名</Typography>
      <Typography variant="body1" sx={{ mb: 2.5 }}>{user.username || '微信用户'}</Typography>
      <TextField label="昵称" value={nickname} onChange={e => setNickname(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField label="楼栋" value={building} onChange={e => setBuilding(e.target.value)} placeholder="如 3 栋" size="small" sx={{ flex: 1 }} />
        <TextField label="单元/门牌" value={unit} onChange={e => setUnit(e.target.value)} placeholder="如 2 单元 501" size="small" sx={{ flex: 1 }} />
      </Box>
      <Box sx={{ mt: 'auto', pt: 2.5 }}>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} fullWidth variant="contained" disableElevation sx={{ py: 1.3, bgcolor: WARM, '&:hover': { bgcolor: '#D85F26' } }}>
          保存
        </Button>
      </Box>
    </>
  )
}

// ===== 修改密码(弹窗内)=====
function PasswordForm({ onDone }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.changePassword({ oldPassword, newPassword }),
    onSuccess: (data) => {
      if (data?.token) api.setToken(data.token)
      toast.success('密码修改成功')
      onDone()
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
    <>
      <TextField type="password" label="旧密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <TextField type="password" label="新密码(至少6位)" value={newPassword} onChange={e => setNewPassword(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
      <TextField type="password" label="确认新密码" value={confirm} onChange={e => setConfirm(e.target.value)} fullWidth size="small" />
      <Box sx={{ mt: 'auto', pt: 2.5 }}>
        <Button onClick={handleSubmit} disabled={!canSubmit} fullWidth variant="contained" disableElevation sx={{ py: 1.3, bgcolor: WARM, '&:hover': { bgcolor: '#D85F26' } }}>
          确认修改
        </Button>
      </Box>
    </>
  )
}

// ===== 我发布的帖子 =====
function MyPosts({ navigate }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('') // '' 全部 | 'open' 进行中 | 'closed' 已完成

  const { data, isLoading } = useQuery({
    queryKey: ['myPosts', status],
    queryFn: () => api.getMyPosts(1, status),
  })
  const list = data?.list ?? []

  const closeMutation = useMutation({
    mutationFn: (id) => api.closePost(id),
    onSuccess: () => {
      toast.success('已标记完成')
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.invalidateQueries({ queryKey: ['posts'] })
    },
  })

  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        我发布的{data?.total ? `(${data.total})` : ''}
      </Typography>

      {/* 状态筛选 */}
      <Tabs
        value={status}
        onChange={(_, v) => setStatus(v)}
        sx={{
          minHeight: 36, mb: 1,
          '& .MuiTab-root': { minHeight: 36, py: 0 },
          '& .Mui-selected': { color: `${WARM} !important` },
          '& .MuiTabs-indicator': { backgroundColor: WARM },
        }}
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
            {/* 进行中的帖子可一键标记完成,点击不冒泡到跳转 */}
            {p.status === 'open' && (
              <Button
                size="small"
                onClick={(e) => { e.stopPropagation(); closeMutation.mutate(p.id) }}
                disabled={closeMutation.isPending}
                sx={{ minWidth: 0, py: 0, px: 1, fontSize: 12, color: WARM }}
              >
                完成
              </Button>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
