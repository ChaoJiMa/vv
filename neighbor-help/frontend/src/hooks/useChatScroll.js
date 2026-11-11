import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 距离文档底部 120px 内视为正在阅读最新消息，收到消息时可自动跟随。 */
const FOLLOW_DISTANCE = 120

function scrollPosition() {
  const doc = document.scrollingElement || document.documentElement
  return { height: doc.scrollHeight, top: window.scrollY || doc.scrollTop || 0 }
}

/** JS 指定 smooth 不受全局 CSS 的减弱动效规则约束，这里尊重系统偏好。 */
function scrollBehavior(requested) {
  return requested === 'smooth' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : requested
}

/**
 * 聊天滚动：首次进入/主动发送跟随最新；阅读历史时保留位置并提示新消息。
 * loadOlder 在请求前记录可见气泡，历史页插入后按气泡位置补偿，而非滚到底部。
 * 调用方以用户和会话为 key 挂载，避免跨会话复用滚动状态。
 */
export function useChatScroll({ messages, pageCount, userId, fetchNextPage }) {
  const listRef = useRef(null)
  const bottomRef = useRef(null)
  const following = useRef(true)
  const forceFollow = useRef(false)
  const previous = useRef(null)
  const historyAnchor = useRef(null)
  const unseen = useRef(false)
  const [hasNewMessages, setHasNewMessages] = useState(false)

  const jumpToLatest = useCallback((behavior = 'smooth') => {
    following.current = true
    forceFollow.current = false
    unseen.current = false
    setHasNewMessages(false)
    bottomRef.current?.scrollIntoView({ behavior: scrollBehavior(behavior), block: 'end' })
  }, [])

  useEffect(() => {
    let resizeFrame = null
    const track = () => {
      const { height, top } = scrollPosition()
      const viewport = window.visualViewport
      const viewportBottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight
      following.current = height - top - viewportBottom <= FOLLOW_DISTANCE
      if (following.current) {
        unseen.current = false
        setHasNewMessages(false)
      }
    }
    const resize = () => {
      // 键盘缩小视口时先保留原本的阅读意图，再等输入栏的避让占位更新后跟随。
      // 若用户正在读历史，视口变化本身不把他拉回底部。
      if (!following.current && resizeFrame == null) { track(); return }
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        jumpToLatest('auto')
      })
    }
    window.addEventListener('scroll', track, { passive: true })
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', track)
    return () => {
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
      window.removeEventListener('scroll', track)
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('scroll', track)
    }
  }, [jumpToLatest])

  useLayoutEffect(() => {
    if (!messages.length) return undefined
    const last = messages[messages.length - 1]
    const prev = previous.current
    const anchor = historyAnchor.current
    const appended = prev && last.id !== prev.lastId && Number(last.created_at) >= prev.lastTime
    if (anchor && pageCount > anchor.pageCount) {
      const bubble = [...(listRef.current?.querySelectorAll('[data-message-id]') || [])]
        .find(el => el.dataset.messageId === anchor.id)
      // 使用请求完成时的当前位置补偿，加载期间用户继续滚动也不会被拉回旧坐标。
      const top = scrollPosition().top
      const delta = bubble
        ? bubble.getBoundingClientRect().top - anchor.top + top - anchor.scrollTop
        : scrollPosition().height - anchor.height
      window.scrollTo({ top: top + delta, behavior: 'auto' })
      historyAnchor.current = null
    } else if (!prev || forceFollow.current || (appended && following.current)) {
      bottomRef.current?.scrollIntoView({ behavior: scrollBehavior(prev ? 'smooth' : 'auto'), block: 'end' })
      following.current = true
      forceFollow.current = false
    } else if (appended && last.sender_id !== userId && !last.pending) {
      unseen.current = true
    }
    previous.current = { lastId: last.id, lastTime: Number(last.created_at) || 0, pageCount }
    if (following.current) unseen.current = false
    // 徽标是 DOM 几何检查的结果，在下一帧更新，避免布局阶段同步级联更新。
    const frame = requestAnimationFrame(() => {
      setHasNewMessages(unseen.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, pageCount, userId])

  const loadOlder = useCallback(() => {
    const rows = [...(listRef.current?.querySelectorAll('[data-message-id]') || [])]
    const visible = rows.find(el => el.getBoundingClientRect().bottom > 0)
    const position = scrollPosition()
    const anchor = {
      id: visible?.dataset.messageId,
      top: visible?.getBoundingClientRect().top || 0,
      height: position.height,
      scrollTop: position.top,
      pageCount,
    }
    historyAnchor.current = anchor
    return fetchNextPage().then(result => {
      if (result.isError && historyAnchor.current === anchor) historyAnchor.current = null
      return result
    })
  }, [fetchNextPage, pageCount])

  /** 在乐观消息写入前调用，主动发送时即使正在读历史也跟随自己的新消息。 */
  const followNextMessage = useCallback(() => { forceFollow.current = true }, [])
  return { listRef, bottomRef, hasNewMessages, jumpToLatest, followNextMessage, loadOlder }
}
