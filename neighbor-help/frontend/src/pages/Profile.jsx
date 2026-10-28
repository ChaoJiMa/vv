import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useInfiniteQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Avatar from '@mui/material/Avatar'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import { ChevronIcon } from '../components/icons'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { useAppTheme } from '../theme/useAppTheme'
import { toast } from '../toast'
import BottomNav from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'
import { AppShell, Button as UiButton, Sheet, Sticker } from '../components/ui'

const WARM = 'var(--color-primary)'

export default function Profile() {
  const navigate = useNavigate()
  const { user, setUser, logout } = useAuth()
  const { mode, setMode } = useAppTheme()
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
      <AppShell>
        <div style={{ textAlign: 'center', padding: 64 }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>请先登录</p>
          <UiButton type="button" onClick={() => navigate('/login')}>去登录</UiButton>
        </div>
      </AppShell>
    )
  }

  const location = [user.building, user.unit].filter(Boolean).join(' ')

  return (
    <AppShell withNav>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, padding: '14px 16px',
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 17, fontWeight: 700,
      }}>
        我的
      </header>

      <button
        type="button"
        onClick={() => setEditOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 14, width: '100%',
          margin: '12px 16px 0', padding: 16, maxWidth: 'calc(100% - 32px)', boxSizing: 'border-box',
          borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)',
          background: 'linear-gradient(135deg, var(--color-bg-accent) 0%, var(--color-surface) 70%)',
          color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <Avatar src={user.avatar || undefined} sx={{ width: 60, height: 60, bgcolor: 'var(--color-primary)', fontSize: 26, color: 'var(--color-on-primary)' }}>
          {user.avatar ? null : (user.nickname?.[0] || user.username?.[0] || '邻')}
        </Avatar>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 18, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.nickname || user.username || '邻居'}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {location || '未设置楼栋单元'}
          </span>
        </span>
        <ChevronIcon size={20} style={{ color: 'var(--color-text-muted)' }} />
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '12px 16px 0' }}>
        <div style={statCard}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-primary)' }}>{stats?.helped ?? 0}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>帮助了</div>
        </div>
        <div style={statCard}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-primary)' }}>{stats?.received ?? 0}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>获得帮助</div>
        </div>
      </div>

      <section style={cardSection}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 10 }}>外观</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'system', label: '跟随系统' },
            { id: 'light', label: '浅色' },
            { id: 'dark', label: '深色' },
          ].map((opt) => (
            <Sticker key={opt.id} active={mode === opt.id} color="cream" onClick={() => setMode(opt.id)}>
              {opt.label}
            </Sticker>
          ))}
        </div>
      </section>

      <section style={{ ...cardSection, padding: 0, overflow: 'hidden' }}>
        <MenuRow label="编辑资料" onClick={() => setEditOpen(true)} />
        {user.username && <MenuRow label="修改密码" onClick={() => setPwdOpen(true)} />}
        {user.role === 'admin' && (
          <MenuRow label="公告管理" onClick={() => navigate('/announcements/manage')} />
        )}
      </section>

      <section style={cardSection}>
        <MyPosts navigate={navigate} />
      </section>

      <div style={{ padding: '8px 16px 24px' }}>
        <UiButton type="button" variant="ghost" style={{ width: '100%', color: 'var(--color-danger)' }} onClick={() => setLogoutOpen(true)}>
          退出登录
        </UiButton>
      </div>

      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title="编辑资料" heightVh={56}>
        <EditProfileForm key={user.id + String(editOpen)} user={user} setUser={setUser} onDone={() => setEditOpen(false)} />
      </BottomSheet>

      <BottomSheet open={pwdOpen} onClose={() => setPwdOpen(false)} title="修改密码" heightVh={52}>
        <PasswordForm onDone={() => setPwdOpen(false)} />
      </BottomSheet>

      <Sheet open={logoutOpen} onClose={() => setLogoutOpen(false)} title="确定退出登录吗?" heightVh={28}>
        <div style={{ display: 'flex', gap: 10 }}>
          <UiButton type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setLogoutOpen(false)}>取消</UiButton>
          <UiButton type="button" style={{ flex: 1, background: 'var(--color-danger)' }} onClick={() => { logout(); navigate('/login') }}>退出</UiButton>
        </div>
      </Sheet>

      <BottomNav />
    </AppShell>
  )
}

const cardSection = {
  margin: '12px 16px 0',
  padding: 16,
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-card)',
}
const statCard = {
  padding: 14,
  borderRadius: 16,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  textAlign: 'center',
  boxShadow: 'var(--shadow-card)',
}

// ===== 功能菜单行 =====
function MenuRow({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', width: '100%',
        padding: '14px 16px', border: 'none', borderBottom: '1px solid var(--color-border)',
        background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left', minHeight: 48,
      }}
    >
      <span style={{ flex: 1, fontSize: 14 }}>{label}</span>
      <ChevronIcon size={18} style={{ color: 'var(--color-text-muted)' }} />
    </button>
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
    onError: (e) => toast.error(e.message || '保存失败'),
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
    // 旧密码错误等失败必须告知用户
    onError: (e) => toast.error(e.message || '修改失败'),
  })

  const handleSubmit = () => {
    if (newPassword.length < 8) {
      toast.error('新密码至少8位')
      return
    }
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
      <TextField type="password" label="新密码(至少8位)" value={newPassword} onChange={e => setNewPassword(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
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
  const [status, setStatus] = useState('') // '' 全部 | 'open' 进行中 | 'closed' 已完成

  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['myPosts', status],
    queryFn: ({ pageParam }) => api.getMyPosts(pageParam, status),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const list = data?.pages.flatMap(p => p.list) ?? []
  const total = data?.pages?.[0]?.total ?? 0

  // 触底自动加载下一页
  const sentinelRef = useRef(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '120px' })
    io.observe(node)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, list.length])

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1, color: 'var(--color-text-muted)' }}>
        我发布的{total ? `(${total})` : ''}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        {[
          { id: '', label: '全部' },
          { id: 'open', label: '进行中' },
          { id: 'closed', label: '已完成' },
        ].map((opt) => (
          <Sticker key={opt.id || 'all'} active={status === opt.id} onClick={() => setStatus(opt.id)}>
            {opt.label}
          </Sticker>
        ))}
      </Box>

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
            {/* 进行中的帖子可标记完成:跳详情页并自动打开采纳抽屉(统一走采纳流程),点击不冒泡 */}
            {p.status === 'open' && (
              <Button
                size="small"
                onClick={(e) => { e.stopPropagation(); navigate(`/post/${p.id}`, { state: { openAdopt: true } }) }}
                sx={{ minWidth: 0, py: 0, px: 1, fontSize: 12, color: WARM }}
              >
                完成
              </Button>
            )}
          </Box>
        </Box>
      ))}

      {/* 触底加载哨兵 */}
      {list.length > 0 && (
        <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 1.5, color: 'text.disabled' }}>
          {isFetchingNextPage && <CircularProgress size={18} />}
          {!hasNextPage && <Typography variant="caption">没有更多了</Typography>}
        </Box>
      )}
    </Box>
  )
}
