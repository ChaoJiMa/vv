import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../toast'
import { downscaleImage, safeParse } from '../utils/image'
import BottomNav from '../components/BottomNav'
import { AppShell, Button, Field, Sheet } from '../components/ui'

const MAX_IMAGES = 6
const TITLE_PLACEHOLDER = {
  help: '输入你的需求标题',
  idle: '输入物品名称',
  lost: '输入物品名称',
  group: '输入拼单主题',
}
const ENTRY_COLORS = ['mint', 'sky', 'cream', 'primary']

export default function CreatePost() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { id } = useParams()
  const isEdit = !!id

  const [type, setType] = useState(() => (!id && location.state?.type) || '')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [postLocation, setPostLocation] = useState(() => [user?.building, user?.unit].filter(Boolean).join(' '))
  const [moreOpen, setMoreOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [images, setImages] = useState([])
  const [uploading, setUploading] = useState(0)
  const [errors, setErrors] = useState({})
  const titleRef = useRef(null)
  const contentRef = useRef(null)
  const fileInputRef = useRef(null)

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: editing } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
    enabled: isEdit,
  })

  useEffect(() => {
    if (isEdit && editing && editing.status !== 'open') {
      toast.error('已完成的帖子不可编辑')
      navigate(`/post/${id}`, { replace: true })
    }
  }, [isEdit, editing, id, navigate])

  const [filledId, setFilledId] = useState(null)
  const [contactUnavailable, setContactUnavailable] = useState(false)
  if (editing && filledId !== id) {
    setType(editing.type || '')
    setTitle(editing.title || '')
    setContent(editing.content || '')
    if (editing.contactUnavailable) {
      setContact('')
      setContactUnavailable(true)
      setMoreOpen(true)
      toast.error('联系方式暂时无法解密，请重新填写后再保存，勿直接保存空值')
    } else {
      setContact(editing.contact || '')
      setContactUnavailable(false)
      if (editing.contact) setMoreOpen(true)
    }
    setPostLocation(editing.location || '')
    setImages(safeParse(editing.images))
    setFilledId(id)
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit && contactUnavailable && !contact.trim()) {
        return Promise.reject(new Error('联系方式无法加载，请重新填写后再保存'))
      }
      return isEdit
        ? api.updatePost(id, { type, title, content, contact, location: postLocation, images })
        : api.createPost({ type, title, content, contact, location: postLocation, images })
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['post', id] })
      toast.success(isEdit ? '已保存' : '发布成功')
      navigate(`/post/${data.id}`, { replace: true })
    },
    onError: (e) => toast.error(e.message || (isEdit ? '保存失败' : '发布失败')),
  })

  const validate = () => {
    const next = {}
    if (!type) next.type = '请选择分类'
    if (!title.trim()) next.title = '请填写标题'
    if (!content.trim()) next.content = '请填写描述'
    setErrors(next)
    if (next.title) titleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    else if (next.content) contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return Object.keys(next).length === 0
  }

  const canSubmit = type && title.trim() && content.trim() && uploading === 0
  const hasDraft = !isEdit && (type || title.trim() || content.trim() || contact.trim() || images.length)

  const handleCancel = () => {
    if (hasDraft) setCancelOpen(true)
    else navigate(-1)
  }

  const handleSubmit = () => {
    if (!validate() || !canSubmit || mutation.isPending) return
    mutation.mutate()
  }

  const handlePickImages = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) { toast.error(`最多上传 ${MAX_IMAGES} 张图片`); return }
    const todo = files.slice(0, room)
    if (files.length > room) toast.info(`最多上传 ${MAX_IMAGES} 张,已选取前 ${room} 张`)
    setUploading(n => n + todo.length)
    for (const f of todo) {
      try {
        const compressed = await downscaleImage(f)
        const { key } = await api.uploadImage(compressed)
        setImages(prev => [...prev, key])
      } catch (err) {
        toast.error(err.message || '图片上传失败')
      } finally {
        setUploading(n => n - 1)
      }
    }
  }

  const removeImage = (key) => setImages(prev => prev.filter(k => k !== key))

  return (
    <AppShell withNav>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', minHeight: 52,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <button type="button" onClick={handleCancel} style={ghostLink}>取消</button>
        <strong style={{ fontSize: 16 }}>{isEdit ? '编辑' : '发布'}</strong>
        <Button
          type="button"
          onClick={handleSubmit}
          loading={mutation.isPending}
          disabled={!canSubmit}
          style={{ minHeight: 36, padding: '6px 14px', opacity: canSubmit ? 1 : 0.4 }}
        >
          {isEdit ? '保存' : '发布'}
        </Button>
      </header>

      <div style={{ padding: 16 }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600 }}>选择分类</p>
        {errors.type ? <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-danger)' }}>{errors.type}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {menus.map((t, i) => {
            const active = type === t.value
            const tint = ENTRY_COLORS[i % ENTRY_COLORS.length]
            const bg = tint === 'primary' ? 'var(--color-bg-accent)' : `var(--color-accent-${tint})`
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => { setType(t.value); setErrors(e => ({ ...e, type: undefined })) }}
                style={{
                  textAlign: 'left', padding: 14, borderRadius: 16, cursor: 'pointer',
                  border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)',
                  background: active ? 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))' : bg,
                  color: 'var(--color-text)', minHeight: 88,
                }}
              >
                <div style={{ fontSize: 22 }}>{t.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{t.label}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{t.desc}</div>
              </button>
            )
          })}
        </div>

        <div ref={titleRef}>
          <Field
            value={title}
            onChange={e => { setTitle(e.target.value); setErrors(er => ({ ...er, title: undefined })) }}
            onBlur={() => { if (!title.trim()) setErrors(e => ({ ...e, title: '请填写标题' })) }}
            placeholder={TITLE_PLACEHOLDER[type] || '输入标题'}
            maxLength={100}
            error={errors.title}
            style={{ marginBottom: 14 }}
          />
        </div>
        <div ref={contentRef}>
          <Field
            as="textarea"
            value={content}
            onChange={e => { setContent(e.target.value); setErrors(er => ({ ...er, content: undefined })) }}
            onBlur={() => { if (!content.trim()) setErrors(e => ({ ...e, content: '请填写描述' })) }}
            placeholder="详细描述你的需求..."
            maxLength={5000}
            error={errors.content}
            style={{ marginBottom: 14 }}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={handlePickImages}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
          {images.map(key => (
            <div key={key} style={{ position: 'relative', paddingTop: '100%', borderRadius: 12, overflow: 'hidden', background: 'var(--color-bg-accent)' }}>
              <img src={api.imgUrl(key)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                aria-label="删除图片"
                onClick={() => removeImage(key)}
                style={{
                  position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
                  border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 14,
                }}
              >
                ×
              </button>
            </div>
          ))}
          {uploading > 0 && Array.from({ length: uploading }).map((_, i) => (
            <div key={`up-${i}`} style={{ position: 'relative', paddingTop: '100%', borderRadius: 12, background: 'var(--color-bg-accent)' }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>…</div>
            </div>
          ))}
          {images.length + uploading < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                position: 'relative', paddingTop: '100%', borderRadius: 12, cursor: 'pointer',
                border: '1.5px dashed var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)',
              }}
            >
              <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <AddPhotoAlternateOutlinedIcon sx={{ fontSize: 24 }} />
                <span style={{ fontSize: 10 }}>{images.length}/{MAX_IMAGES}</span>
              </span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', width: '100%', border: 'none', background: 'transparent',
            color: 'var(--color-text-muted)', cursor: 'pointer', padding: '10px 0', minHeight: 44,
          }}
        >
          <span style={{ flex: 1, textAlign: 'left', fontSize: 14 }}>更多选项</span>
          <ExpandMoreIcon sx={{ transform: moreOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        {moreOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <Field
              label="联系方式"
              value={contact}
              onChange={e => setContact(e.target.value)}
              placeholder="微信号 / 手机号(可选)"
              maxLength={50}
            />
            <Field
              label="位置"
              value={postLocation}
              onChange={e => setPostLocation(e.target.value)}
              placeholder="如 3 栋 2 单元"
              maxLength={50}
            />
          </div>
        )}

        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
          为保证社区秩序,1 分钟最多发布 5 条
        </p>
      </div>

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="放弃这次发布?" heightVh={30}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>
          你填写的内容尚未发布,离开将不会保留。
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setCancelOpen(false)}>继续编辑</Button>
          <Button type="button" style={{ flex: 1, background: 'var(--color-danger)' }} onClick={() => navigate(-1)}>放弃</Button>
        </div>
      </Sheet>

      <BottomNav />
    </AppShell>
  )
}

const ghostLink = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 15,
  cursor: 'pointer',
  minHeight: 44,
  minWidth: 48,
  padding: '0 8px',
}
