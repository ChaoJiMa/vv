import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { toast } from '../toast'

// 只在当前标签页保留一天的文字，不保存上传 key，避免恢复过期图片或跨账号混用。
const DRAFT_TTL = 24 * 60 * 60 * 1000
const FIELD_LIMITS = { type: 16, title: 100, content: 5000, contact: 50, postLocation: 50 }

/** 草稿按用户与新建/编辑目标隔离；访客不生成可写入的存储位置。 */
export function postDraftKey(userId, postId) {
  if (!userId) return null
  return `nh-post-draft:v1:${encodeURIComponent(userId)}:${postId ? `edit:${encodeURIComponent(postId)}` : 'new'}`
}

/** 恢复经过版本、有效期和字段长度校验的文字草稿；存储不可用或损坏时回退到原始表单。 */
export function readPostDraft(key) {
  if (!key) return null
  try {
    const draft = JSON.parse(sessionStorage.getItem(key))
    if (!draft) return null
    const age = Date.now() - draft.savedAt
    const validFields = draft.fields && Object.entries(FIELD_LIMITS).every(([field, limit]) => (
      typeof draft.fields[field] === 'string' && draft.fields[field].length <= limit
    ))
    if (draft.version !== 1 || !Number.isFinite(draft.savedAt) || age < -60000 || age > DRAFT_TTL || !validFields
      || !['', 'help', 'idle', 'lost', 'group'].includes(draft.fields.type)) {
      sessionStorage.removeItem(key)
      return null
    }
    return { fields: draft.fields, imagesChanged: !!draft.imagesChanged }
  } catch {
    return null
  }
}

/**
 * 自动保存文字并拦截离开编辑器。dirty 由表单和服务器初值比较得出，初始化本身不触发提醒。
 * SPA 跳转使用 data router 的 blocker；刷新/关闭交给浏览器原生确认。成功提交与明确放弃可同步放行。
 */
export function usePostDraft({ storageKey, fields, dirty, imagesChanged }) {
  const leaving = useRef(false)
  const storageWarningShown = useRef(false)
  const serializedFields = JSON.stringify(fields)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    dirty && !leaving.current
    // 同一发布页只重选分类时保留表单，不弹离开提醒。
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ))

  const save = () => {
    if (!storageKey || leaving.current) return true
    try {
      if (dirty) {
        sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, savedAt: Date.now(), fields, imagesChanged }))
      } else {
        sessionStorage.removeItem(storageKey)
      }
      return true
    } catch {
      if (!storageWarningShown.current) {
        storageWarningShown.current = true
        toast.info('草稿暂时无法保存，离开前请先复制文字内容')
      }
      return false
    }
  }

  useEffect(() => {
    if (!storageKey || leaving.current) return
    try {
      if (dirty) {
        sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, savedAt: Date.now(), fields: JSON.parse(serializedFields), imagesChanged }))
      } else {
        sessionStorage.removeItem(storageKey)
      }
    } catch {
      if (!storageWarningShown.current) {
        storageWarningShown.current = true
        toast.info('草稿暂时无法保存，离开前请先复制文字内容')
      }
    }
  }, [storageKey, serializedFields, dirty, imagesChanged])

  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event) => {
      if (leaving.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const finish = () => {
    leaving.current = true
    try { if (storageKey) sessionStorage.removeItem(storageKey) } catch { /* 存储受限时仍允许完成已提交或已明确放弃的导航。 */ }
  }

  return {
    blocked: blocker.state === 'blocked',
    stay: () => { if (blocker.state === 'blocked') blocker.reset() },
    keepAndLeave: () => {
      if (blocker.state !== 'blocked' || !save()) return
      leaving.current = true
      blocker.proceed()
    },
    discardAndLeave: () => {
      finish()
      if (blocker.state === 'blocked') blocker.proceed()
    },
    finish,
  }
}
