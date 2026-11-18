import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, useLocation, useNavigationType } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { captureSession, isSessionCurrent, assertSessionCurrent } from '../session'
import { useAuth } from '../hooks/useAuth'
import { postDraftKey, readPostDraft, usePostDraft } from '../hooks/usePostDraft'
import { toast } from '../toast'
import { downscaleImage, normalizeImages } from '../utils/image'
import BottomNav from '../components/BottomNav'
import { AppShell, Button, EmptyState, Field, Sheet } from '../components/ui'
import Loading from '../components/Loading'
import { ChevronIcon, ImageIcon } from '../components/icons'
import TypePickSheet from '../components/TypePickSheet'
import { formatResidence } from '../utils/residence'

const MAX_IMAGES = 6
const TITLE_PLACEHOLDER = {
  help: '输入你的需求标题',
  idle: '输入物品名称',
  lost: '输入物品名称',
  group: '输入拼单主题',
}

/** 把原帖或新建入口转换成表单基准；图片只取服务端已有引用，不从文字草稿恢复。 */
function editorBaseline(editing, initialType, user) {
  return {
    type: editing?.type || initialType || '',
    title: editing?.title || '',
    content: editing?.content || '',
    contact: editing?.contactUnavailable ? '' : editing?.contact || '',
    // 解密状态跟随相同的表单快照；保留本地输入时不能用后台新状态解除空联系方式保护。
    contactUnavailable: !!editing?.contactUnavailable,
    // 新帖默认只带楼栋；编辑沿用明确的帖子位置，不从个人房号补全或重写历史内容。
    postLocation: editing ? editing.location || '' : formatResidence(user?.building, ''),
    images: normalizeImages(editing?.images, editing?.cover),
  }
}

/** 编辑页先取得原帖，再初始化表单；用户/帖子变化时重新挂载，禁止把旧账号的输入保存给新账号。 */
export default function CreatePost() {
  const { user } = useAuth()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: editing, isLoading, isError, refetch } = useQuery({
    queryKey: ['post', id, user?.id],
    queryFn: () => api.getPost(id),
    enabled: !!id,
  })

  useEffect(() => {
    if (id && editing && editing.status !== 'open') {
      toast.error('已完成的帖子不可编辑')
      navigate(`/note/${id}`, { replace: true })
    }
  }, [id, editing, navigate])

  if (id && isLoading) return <Loading />
  if (id && isError && !editing) return (
    <AppShell>
      <EmptyState title="暂时无法加载帖子" description="请检查网络后重试，草稿会在原帖加载后恢复。" actionLabel="重试" onAction={() => refetch()} />
    </AppShell>
  )
  if (id && (!editing || editing.status !== 'open')) return <Loading />
  return <PostEditor key={`${user?.id || 'guest'}:${id || 'new'}`} editing={editing} />
}

/** 发帖与编辑共用表单；草稿只恢复文字，原帖图片重新从服务器读取。 */
function PostEditor({ editing }) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { id } = useParams()
  const isEdit = !!id
  const storageKey = postDraftKey(user?.id, id)
  const [baseline, setBaseline] = useState(() => editorBaseline(editing, location.state?.type, user))
  const [seenEditing, setSeenEditing] = useState(editing)
  const [restoredDraft] = useState(() => readPostDraft(storageKey))
  const initialFields = restoredDraft ? {
    ...restoredDraft.fields,
    // 只有实际的新入口覆盖草稿分类；刷新/历史返回仍携带旧 state，不能把后续改过的分类改回去。
    type: (!isEdit && navigationType !== 'POP' && location.state?.type) || restoredDraft.fields.type,
  } : baseline
  const [type, setType] = useState(initialFields.type)
  const [typePickOpen, setTypePickOpen] = useState(() => !id && !initialFields.type)
  const [title, setTitle] = useState(initialFields.title)
  const [content, setContent] = useState(initialFields.content)
  const [contact, setContact] = useState(initialFields.contact)
  const [postLocation, setPostLocation] = useState(initialFields.postLocation)
  const [moreOpen, setMoreOpen] = useState(() => !!(initialFields.contact || editing?.contactUnavailable || restoredDraft?.fields.postLocation !== undefined))
  const [images, setImages] = useState(baseline.images)
  const [uploading, setUploading] = useState(0)
  const [errors, setErrors] = useState({})
  const titleRef = useRef(null)
  const contentRef = useRef(null)
  const fileInputRef = useRef(null)
  const editorActive = useRef(true)

  // 离开后停止后续压缩/上传，并禁止保存的迟到响应把用户从新页面带回；支持 StrictMode 重放。
  useEffect(() => {
    editorActive.current = true
    return () => { editorActive.current = false }
  }, [])

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })

  const contactUnavailable = baseline.contactUnavailable
  useEffect(() => {
    if (contactUnavailable) toast.error('联系方式暂时无法解密，请重新填写后再保存，勿直接保存空值')
  }, [contactUnavailable])

  const fields = { type, title, content, contact, postLocation }
  const imagesChanged = JSON.stringify(images.map(image => image.key)) !== JSON.stringify(baseline.images.map(image => image.key))
  // 新建时仅选分类不算输入；编辑时分类变化是真实修改。图片上传中同样需要离开保护。
  const dirty = Object.entries(fields).some(([field, value]) => (
    (isEdit || field !== 'type') && value !== baseline[field]
  )) || imagesChanged || uploading > 0
  const draft = usePostDraft({ storageKey, fields, dirty, imagesChanged: imagesChanged || uploading > 0 })

  const mutation = useMutation({
    mutationFn: ({ session }) => {
      assertSessionCurrent(session)
      if (isEdit && contactUnavailable && !contact.trim()) {
        return Promise.reject(new Error('联系方式无法加载，请重新填写后再保存'))
      }
      return isEdit
        ? api.updatePost(id, { type, title, content, contact, location: postLocation, images })
        : api.createPost({ type, title, content, contact, location: postLocation, images })
    },
    onSuccess: (data, { session }) => {
      if (!isSessionCurrent(session)) return
      qc.invalidateQueries({ queryKey: ['posts'] })
      qc.invalidateQueries({ queryKey: ['myPosts'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['post', id, user?.id] })
      // 旧编辑器离开后仍可刷新服务端数据，但不能清掉重新进入同一帖子后产生的新草稿。
      if (!editorActive.current) return
      draft.finish()
      toast.success(isEdit ? '已保存' : '发布成功')
      navigate(`/note/${data.id}`, { replace: true })
    },
    onError: (e, { session }) => {
      if (editorActive.current && isSessionCurrent(session)) toast.error(e.message || (isEdit ? '保存失败' : '发布失败'))
    },
  })

  // 详情缓存可先于后台的新原帖到达。只有仍未修改、未恢复草稿的编辑器才能安全同步；
  // 同次渲染调整基准与所有字段，避免自动保存把同步过程误记为用户的新草稿。
  if (isEdit && editing !== seenEditing) {
    setSeenEditing(editing)
    if (!restoredDraft && !dirty && !mutation.isPending) {
      const next = editorBaseline(editing, undefined, user)
      setBaseline(next)
      setType(next.type)
      setTitle(next.title)
      setContent(next.content)
      setContact(next.contact)
      setPostLocation(next.postLocation)
      setImages(next.images)
      setMoreOpen(open => open || !!(next.contact || editing?.contactUnavailable))
      setErrors({})
    }
  }

  // 底栏 + 的分类面板位于正文 fieldset 外，保存中必须同步禁止该入口改动正在提交的分类。
  const [navKey, setNavKey] = useState(location.key)
  if (!isEdit && location.key !== navKey) {
    setNavKey(location.key)
    if (!mutation.isPending && navigationType !== 'POP' && location.state?.type) {
      setType(location.state.type)
      setTypePickOpen(false)
    }
  }

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
  const leaveCreate = () => {
    // 新建发布统一回首页，避免登录后进发布再「返回」落到登录页
    // 编辑优先退回原来源，避免 [详情, 编辑] 被替换成重复的 [详情, 详情]。
    // 浏览器 data router 的 idx=0 表示直接深链进入，不能退到站外，回退至原帖即可。
    if (isEdit && window.history.state?.idx === 0) navigate(`/note/${id}`, { replace: true })
    else if (isEdit) navigate(-1)
    else navigate('/', { replace: true })
  }

  const handleSubmit = () => {
    if (!validate() || !canSubmit || mutation.isPending) return
    mutation.mutate({ session: captureSession() })
  }

  const handlePickImages = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    // 上传中的图片已占用名额，第二次选图不能重复使用这些槽位。
    const room = MAX_IMAGES - images.length - uploading
    if (room <= 0) { toast.error(`最多上传 ${MAX_IMAGES} 张图片`); return }
    const todo = files.slice(0, room)
    if (files.length > room) toast.info(`最多上传 ${MAX_IMAGES} 张,已选取前 ${room} 张`)
    const session = captureSession()
    setUploading(n => n + todo.length)
    let remaining = todo.length
    try {
      for (const f of todo) {
        try {
          if (!editorActive.current) break
          assertSessionCurrent(session)
          const { file, width, height } = await downscaleImage(f)
          if (!editorActive.current) break
          assertSessionCurrent(session)
          const data = await api.uploadImage(file, { width, height }, session)
          assertSessionCurrent(session)
          if (!editorActive.current) break
          const row = { key: data.key }
          if (data.width > 0 && data.height > 0) {
            row.width = data.width
            row.height = data.height
          } else if (width > 0 && height > 0) {
            row.width = width
            row.height = height
          }
          setImages(prev => [...prev, row])
        } catch (err) {
          if (!editorActive.current || !isSessionCurrent(session)) break
          toast.error(err.message || '图片上传失败')
        }
        remaining--
        if (editorActive.current) setUploading(n => n - 1)
      }
    } finally {
      // 中断后同时撤下整批尚未处理的占位，避免上传计数卡住。
      if (remaining && editorActive.current) setUploading(n => n - remaining)
    }
  }

  const removeImage = (key) => setImages(prev => prev.filter(img => img.key !== key))
  const typeLabel = menus.find(m => m.value === type)?.label || '选择分类'

  return (
    <AppShell withNav>
      <header className="nh-page-chrome-top" style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'calc(10px + var(--safe-top)) 12px 10px', minHeight: 52,
        // 吸顶工具栏借全局 chrome 类衔接顶部柔光，表单和按钮保留自己的表面颜色。
        borderBottom: '1px solid var(--color-border)',
      }}>
        <button type="button" onClick={leaveCreate} style={ghostLink}>取消</button>
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

      {/* 请求已经提交后暂停修改，避免成功跳转把发送期间新输入但未提交的内容丢掉。 */}
      <fieldset disabled={mutation.isPending} style={{ padding: 16, margin: 0, border: 0, minWidth: 0 }}>
        {restoredDraft && (
          <p role="status" style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 12, background: 'var(--color-bg-accent)', fontSize: 13, lineHeight: 1.6 }}>
            已恢复当前标签页中上次未保存的文字草稿。{restoredDraft.imagesChanged ? '图片改动请重新选择。' : ''}
          </p>
        )}
        <button
          type="button"
          onClick={() => setTypePickOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            marginBottom: 14, padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
            border: errors.type ? '1.5px solid var(--color-danger)' : '1.5px solid var(--color-border)',
            background: 'var(--color-surface)', color: 'var(--color-text)',
          }}
        >
          <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 700 }}>
            {type ? typeLabel : '选择分类'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>更换</span>
          <ChevronIcon size={20} style={{ color: 'var(--color-text-muted)', transform: 'rotate(90deg)' }} />
        </button>
        {errors.type ? <p style={{ margin: '-6px 0 12px', fontSize: 12, color: 'var(--color-danger)' }}>{errors.type}</p> : null}

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
          {images.map(img => (
            <div key={img.key} style={{ position: 'relative', paddingTop: '100%', borderRadius: 12, overflow: 'hidden', background: 'var(--color-bg-accent)' }}>
              <img src={api.imgUrl(img.key)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                aria-label="删除图片"
                onClick={() => removeImage(img.key)}
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
                <ImageIcon size={24} />
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
          <ChevronIcon size={20} style={{ transform: moreOpen ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .2s' }} />
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
              label="位置（公开展示）"
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
      </fieldset>

      <Sheet open={draft.blocked} onClose={draft.stay} title={isEdit ? '离开编辑？' : '离开发帖？'}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>
          {mutation.isPending ? '正在保存，请稍候。' : '你填写的内容尚未保存。文字草稿保留在当前标签页，图片改动需要重新选择；草稿最多保留 24 小时。'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button type="button" variant="secondary" onClick={draft.stay}>继续编辑</Button>
          <Button type="button" disabled={mutation.isPending} onClick={draft.keepAndLeave}>保留文字草稿并离开</Button>
          <Button type="button" variant="ghost" style={{ color: 'var(--color-danger)' }} disabled={mutation.isPending} onClick={draft.discardAndLeave}>放弃修改并离开</Button>
        </div>
      </Sheet>

      <TypePickSheet
        open={typePickOpen}
        onClose={() => {
          setTypePickOpen(false)
          if (!type && !isEdit) leaveCreate()
        }}
        value={type}
        title={type ? '更换分类' : '选择分类'}
        onPick={(v) => {
          if (mutation.isPending) return
          setType(v)
          setErrors(e => ({ ...e, type: undefined }))
          setTypePickOpen(false)
        }}
      />

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
