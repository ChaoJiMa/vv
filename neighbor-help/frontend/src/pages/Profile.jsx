import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import {
  MoreIcon, ThemeMoonIcon, ThemeSunIcon, ThemeSystemIcon,
} from '../components/icons'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { useAppTheme } from '../theme/useAppTheme'
import { toast } from '../toast'
import { resolveAvatarUrl } from '../utils/avatar'
import { displayInitial, displayName } from '../utils/displayName'
import { digitsOnly, formatResidence } from '../utils/residence'
import { scrollToTop } from '../utils/scrollToTop'
import { downscaleImage } from '../utils/image'
import BottomNav from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'
import {
  AppShell, Button, Field, PostCard, PostFeed, Sheet,
} from '../components/ui'
import { EmptyPosts } from '../components/illustrations/EmptyArts'

const THEME_CYCLE = ['system', 'light', 'dark']
const themeAria = {
  system: '当前：跟随系统，点击切换',
  light: '当前：浅色，点击切换',
  dark: '当前：深色，点击切换',
}
function nextThemeMode(mode) {
  const i = THEME_CYCLE.indexOf(mode)
  return THEME_CYCLE[(i < 0 ? 0 : i + 1) % THEME_CYCLE.length]
}

export default function Profile() {
  const navigate = useNavigate()
  const { user, setUser, logout } = useAuth()
  const { mode, setMode } = useAppTheme()
  const [editOpen, setEditOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [compact, setCompact] = useState(false)
  const [status, setStatus] = useState('')
  const heroRef = useRef(null)
  const menuRef = useRef(null)

  const { data: stats } = useQuery({
    queryKey: ['myStats'],
    queryFn: () => api.getMyStats(),
    enabled: !!user,
  })

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const {
    data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['myPosts', status],
    queryFn: ({ pageParam }) => api.getMyPosts(pageParam, status),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: !!user,
    // 全部/进行中/已完成切换时保留上一屏，避免闪四个骨架框
    placeholderData: keepPreviousData,
  })
  const list = data?.pages.flatMap(p => p.list) ?? []

  useEffect(() => {
    const onScroll = () => {
      const h = heroRef.current?.offsetHeight ?? 180
      setCompact(window.scrollY > Math.max(48, h - 56))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    scrollToTop()
  }, [status])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [menuOpen])

  if (!user) {
    return (
      <AppShell>
        <div style={{ textAlign: 'center', padding: 64 }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>请先登录</p>
          <Button type="button" onClick={() => navigate('/login')}>去登录</Button>
        </div>
      </AppShell>
    )
  }

  const location = formatResidence(user.building, user.unit)
  const avatarSrc = resolveAvatarUrl(user.avatar)

  return (
    <AppShell withNav>
      {/* 浮层顶栏：上滑后收起 */}
      <div
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, zIndex: 40,
          maxWidth: 480, margin: '0 auto',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: 'calc(10px + var(--safe-top)) 12px 10px',
          opacity: compact ? 0 : 1,
          transform: compact ? 'translateY(-8px)' : 'translateY(0)',
          pointerEvents: compact ? 'none' : 'auto',
          transition: 'opacity 220ms ease, transform 220ms ease',
        }}
      >
        <IconChip
          ariaLabel={themeAria[mode] || '切换主题'}
          title={themeAria[mode]}
          onClick={() => setMode(nextThemeMode(mode))}
        >
          <span key={mode} className="nh-theme-icon">
            {mode === 'light' ? <ThemeSunIcon size={20} />
              : mode === 'dark' ? <ThemeMoonIcon size={20} />
                : <ThemeSystemIcon size={20} />}
          </span>
        </IconChip>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <IconChip
            ariaLabel="更多"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(o => !o)
            }}
          >
            <MoreIcon size={20} />
          </IconChip>
          {menuOpen && (
            <div
              style={menuPanel}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <MenuItem label="编辑资料" onClick={() => { setMenuOpen(false); setEditOpen(true) }} />
              {user.username && (
                <MenuItem label="修改密码" onClick={() => { setMenuOpen(false); setPwdOpen(true) }} />
              )}
              <MenuItem
                label="退出登录"
                danger
                onClick={() => { setMenuOpen(false); setLogoutOpen(true) }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 头区 */}
      <section
        ref={heroRef}
        style={{ position: 'relative', padding: 'calc(56px + var(--safe-top)) 16px 20px', overflow: 'hidden' }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(165deg, color-mix(in srgb, var(--color-primary) 18%, transparent) 0%, color-mix(in srgb, var(--color-accent-cream, #F5E6C8) 42%, transparent) 45%, transparent 85%)',
          }}
        />
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          aria-label="编辑资料"
          style={{
            position: 'relative',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            // 热区贴合内容，不全宽铺开，避免盖住右上角 ⋯
            width: 'auto', maxWidth: '80%', margin: '0 auto',
            border: 'none', background: 'transparent', padding: '4px 12px',
            color: 'var(--color-text)', cursor: 'pointer',
          }}
        >
          <span style={{
            width: 80, height: 80, borderRadius: 40,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--color-primary)', color: 'var(--color-on-primary)',
            fontSize: 32, fontWeight: 700, overflow: 'hidden',
            boxShadow: '0 0 0 3px var(--color-surface)',
          }}>
            {avatarSrc
              ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : displayInitial(user)}
          </span>
          <span style={{
            marginTop: 12, fontSize: 20, fontWeight: 800,
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName(user)}
          </span>
          <span style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {location || '未设置楼栋房号'}
          </span>
        </button>

        <div style={{
          position: 'relative',
          display: 'flex', justifyContent: 'center', gap: 40,
          marginTop: 18,
        }}>
          <Stat n={stats?.helped ?? 0} label="帮助了" />
          <Stat n={stats?.received ?? 0} label="获得帮助" />
        </div>
      </section>

      {/* Tab：上滑后吸顶；top:0 + padding 吃进安全区，背景铺满灵动岛下方 */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--color-border)',
          padding: 'calc(8px + var(--safe-top)) 16px 8px',
        }}
      >
        <div style={segTrack} role="tablist" aria-label="帖子状态">
          <span
            aria-hidden
            className="nh-profile-seg-thumb"
            style={{
              ...segThumb,
              transform: status === 'open'
                ? 'translateX(calc(100% + 4px))'
                : status === 'closed'
                  ? 'translateX(calc(200% + 8px))'
                  : 'translateX(0)',
            }}
          />
          {[
            { id: '', label: '全部' },
            { id: 'open', label: '进行中' },
            { id: 'closed', label: '已完成' },
          ].map((opt) => (
            <SegTab
              key={opt.id || 'all'}
              active={status === opt.id}
              onClick={() => setStatus(opt.id)}
              label={opt.label}
            />
          ))}
        </div>
      </div>

      <PostFeed
        style={{ padding: '12px 16px 24px' }}
        feedKey={status}
        feedClassName="nh-profile-feed"
        items={list}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        empty={{
          illustration: <EmptyPosts />,
          title: status === 'open' ? '没有进行中的帖子' : status === 'closed' ? '没有已完成的帖子' : '还没有发布过',
          description: '去发布第一条邻里动态吧',
          actionLabel: '去发布',
          onAction: () => navigate('/create'),
        }}
        renderItem={(post, { aspect }) => (
          <PostCard
            post={post}
            menu={menuMap[post.type]}
            aspect={aspect}
            onClick={() => navigate(`/note/${post.id}`)}
          />
        )}
      />

      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title="编辑资料">
        <EditProfileForm key={user.id + String(editOpen)} user={user} setUser={setUser} onDone={() => setEditOpen(false)} />
      </BottomSheet>

      <BottomSheet open={pwdOpen} onClose={() => setPwdOpen(false)} title="修改密码">
        <PasswordForm onDone={() => setPwdOpen(false)} />
      </BottomSheet>

      <Sheet open={logoutOpen} onClose={() => setLogoutOpen(false)} title="确定退出登录吗?">
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setLogoutOpen(false)}>取消</Button>
          <Button type="button" style={{ flex: 1, background: 'var(--color-danger)' }} onClick={() => { logout(); navigate('/login') }}>退出</Button>
        </div>
      </Sheet>

      <BottomNav />
      <style>{`
        .nh-profile-seg-thumb {
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-theme-icon {
          display: inline-flex;
          animation: nhThemeIconIn 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .nh-profile-feed {
          animation: nhProfileFeedIn 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes nhThemeIconIn {
          from { opacity: 0; transform: rotate(-28deg) scale(0.85); }
          to { opacity: 1; transform: rotate(0) scale(1); }
        }
        @keyframes nhProfileFeedIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-profile-seg-thumb { transition: none !important; }
          .nh-theme-icon, .nh-profile-feed { animation: none !important; }
        }
      `}</style>
    </AppShell>
  )
}

function Stat({ n, label }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 72 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text)', lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function IconChip({ children, onClick, ariaLabel, title, ...rest }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      {...rest}
      onClick={onClick}
      style={{
        width: 40, height: 40, border: 'none', borderRadius: 20,
        background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
        color: 'var(--color-text)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 0 0 1px var(--color-border), 0 2px 8px color-mix(in srgb, var(--color-text) 8%, transparent)',
        backdropFilter: 'blur(8px)',
        transition: 'background 0.3s ease, color 0.3s ease',
      }}
    >
      {children}
    </button>
  )
}

const menuPanel = {
  position: 'absolute',
  top: 44, right: 0,
  minWidth: 148,
  padding: 6,
  borderRadius: 12,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-card)',
  zIndex: 50,
}

function MenuItem({ label, onClick, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        border: 'none', background: 'transparent', cursor: 'pointer',
        padding: '10px 12px', borderRadius: 8,
        fontSize: 14, fontWeight: 600,
        color: danger ? 'var(--color-danger)' : 'var(--color-text)',
      }}
    >
      {label}
    </button>
  )
}

const segTrack = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 4,
  padding: 4,
  borderRadius: 12,
  background: 'var(--color-bg-accent)',
  border: '1px solid var(--color-border)',
}

const segThumb = {
  position: 'absolute',
  top: 4, bottom: 4, left: 4,
  width: 'calc((100% - 16px) / 3)',
  borderRadius: 10,
  background: 'var(--color-surface)',
  boxShadow: '0 1px 3px color-mix(in srgb, var(--color-text) 12%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-primary) 14%, transparent)',
  pointerEvents: 'none',
  zIndex: 0,
}

function SegTab({ active, onClick, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        position: 'relative', zIndex: 1,
        border: 'none', borderRadius: 10, minHeight: 36,
        padding: '0 6px', cursor: 'pointer', fontSize: 13,
        fontWeight: active ? 700 : 600,
        background: 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
        transition: 'color 180ms ease',
      }}
    >
      {label}
    </button>
  )
}

function EditProfileForm({ user, setUser, onDone }) {
  const qc = useQueryClient()
  const [nickname, setNickname] = useState(user.nickname || '')
  const [building, setBuilding] = useState(user.building || '')
  const [unit, setUnit] = useState(user.unit || '')
  // undefined=未改；null=清除；string=新 R2 key
  const [avatarDraft, setAvatarDraft] = useState(undefined)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const previewSrc = avatarDraft === undefined
    ? resolveAvatarUrl(user.avatar)
    : (avatarDraft ? resolveAvatarUrl(avatarDraft) : null)
  const initial = displayInitial({ nickname: nickname.trim() || user.nickname })

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        nickname: nickname.trim(),
        building: building.trim(),
        unit: unit.trim(),
      }
      if (avatarDraft !== undefined) body.avatar = avatarDraft
      return api.updateMe(body)
    },
    onSuccess: () => {
      setUser(prev => ({
        ...prev,
        nickname: nickname.trim(),
        building: building.trim(),
        unit: unit.trim(),
        ...(avatarDraft !== undefined ? { avatar: avatarDraft } : {}),
      }))
      // 头像/昵称变更后刷新列表与详情里的作者信息
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      qc.invalidateQueries({ queryKey: ['post'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['thread'] })
      toast.success('保存成功')
      onDone()
    },
    onError: (e) => toast.error(e.message || '保存失败'),
  })

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const { file: out, width, height } = await downscaleImage(file, 512)
      const data = await api.uploadImage(out, { width, height })
      setAvatarDraft(data.key)
    } catch (err) {
      toast.error(err.message || '头像上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          disabled={uploading || mutation.isPending}
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
          style={{
            position: 'relative', width: 88, height: 88, borderRadius: 44,
            border: 'none', padding: 0, cursor: uploading ? 'wait' : 'pointer',
            overflow: 'hidden',
            background: 'var(--color-primary)', color: 'var(--color-on-primary)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, fontWeight: 700,
            boxShadow: '0 0 0 3px var(--color-surface)',
            opacity: uploading ? 0.7 : 1,
          }}
        >
          {previewSrc
            ? <img src={previewSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initial}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
        <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || mutation.isPending}
            style={{ border: 'none', background: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >
            {uploading ? '上传中…' : '更换头像'}
          </button>
          {previewSrc ? (
            <button
              type="button"
              onClick={() => setAvatarDraft(null)}
              disabled={uploading || mutation.isPending}
              style={{ border: 'none', background: 'none', color: 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              清除
            </button>
          ) : avatarDraft === null ? (
            <button
              type="button"
              onClick={() => setAvatarDraft(undefined)}
              disabled={uploading || mutation.isPending}
              style={{ border: 'none', background: 'none', color: 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              撤销清除
            </button>
          ) : null}
        </div>
      </div>
      <Field label="昵称" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="邻居怎么称呼你" />
      <div style={{ display: 'flex', gap: 10 }}>
        <Field
          label="楼栋"
          inputMode="numeric"
          value={building}
          onChange={e => setBuilding(digitsOnly(e.target.value))}
          placeholder="如 3"
          style={{ flex: 1 }}
        />
        <Field
          label="房号"
          inputMode="numeric"
          value={unit}
          onChange={e => setUnit(digitsOnly(e.target.value))}
          placeholder="如 501"
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ paddingTop: 8 }}>
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={uploading}
          style={{ width: '100%' }}
        >
          保存
        </Button>
      </div>
    </div>
  )
}

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field type="password" label="旧密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
      <Field type="password" label="新密码(至少8位)" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
      <Field type="password" label="确认新密码" value={confirm} onChange={e => setConfirm(e.target.value)} />
      <div style={{ paddingTop: 8 }}>
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit} loading={mutation.isPending} style={{ width: '100%' }}>
          确认修改
        </Button>
      </div>
    </div>
  )
}
