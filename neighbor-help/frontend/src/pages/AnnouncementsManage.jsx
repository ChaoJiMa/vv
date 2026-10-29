import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'
import { AppShell, Button, EmptyState, Field, Sheet, Sticker } from '../components/ui'
import { BackIcon } from '../components/icons'
import { EmptyNotices } from '../components/illustrations/EmptyArts'

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
      <AppShell>
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>加载中…</div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 'calc(8px + var(--safe-top)) 12px 8px', minHeight: 52,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <button type="button" aria-label="返回" onClick={() => navigate('/profile')} style={iconBtn}>
          <BackIcon size={22} />
        </button>
        <h1 style={{ margin: 0, flex: 1, fontSize: 17, fontWeight: 700 }}>公告管理</h1>
        <Button
          type="button"
          onClick={() => { setEditing(null); setFormOpen(true) }}
          style={{ minHeight: 36, padding: '6px 14px' }}
        >
          新增
        </Button>
      </header>

      <div style={{ padding: '8px 0 24px' }}>
        {isLoading && <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>加载中…</div>}
        {!isLoading && list.length === 0 && (
          <EmptyState
            illustration={<EmptyNotices />}
            title="还没有公告"
            description="点右上角新增一条滚动公告"
            actionLabel="新增公告"
            onAction={() => { setEditing(null); setFormOpen(true) }}
          />
        )}
        {!isLoading && list.map((row) => (
          <article
            key={row.id}
            style={{
              margin: '0 16px 12px',
              padding: 14,
              borderRadius: 'var(--radius-card)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
              <p style={{ margin: 0, flex: 1, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                {row.content}
              </p>
              <Sticker
                active={!!row.enabled}
                color="cream"
                style={{ minHeight: 28, padding: '4px 10px', fontSize: 12, pointerEvents: 'none' }}
              >
                {row.enabled ? '启用' : '停用'}
              </Sticker>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>排序 {row.sort ?? 0}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={textAct} onClick={() => { setEditing(row); setFormOpen(true) }}>编辑</button>
              <button
                type="button"
                style={textAct}
                disabled={updateMut.isPending}
                onClick={() => updateMut.mutate({ id: row.id, enabled: row.enabled ? 0 : 1 })}
              >
                {row.enabled ? '停用' : '启用'}
              </button>
              <button type="button" style={{ ...textAct, color: 'var(--color-danger)' }} onClick={() => setDeleteTarget(row)}>删除</button>
            </div>
          </article>
        ))}
      </div>

      <Sheet
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
      </Sheet>

      <Sheet open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="确定删除这条公告吗?" heightVh={28}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button
            type="button"
            loading={deleteMut.isPending}
            style={{ flex: 1, background: 'var(--color-danger)' }}
            onClick={() => deleteMut.mutate(deleteTarget.id)}
          >
            删除
          </Button>
        </div>
      </Sheet>
    </AppShell>
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
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
      <Field
        as="textarea"
        label="公告内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={200}
      />
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -8 }}>{content.length}/200</div>
      <Field
        label="排序(可选,越大越靠前)"
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        type="number"
      />
      <Button type="submit" loading={pending} style={{ width: '100%' }}>
        {initial ? '保存' : '新增'}
      </Button>
    </form>
  )
}

const iconBtn = {
  width: 44, height: 44, border: 'none', borderRadius: 22,
  background: 'transparent', color: 'var(--color-text)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const textAct = {
  border: 'none', background: 'transparent', color: 'var(--color-primary)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36, padding: '4px 8px',
}
