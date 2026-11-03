import { useLayoutEffect, useRef, useState } from 'react'

// 只保存浏览位置和页数，不持久化帖子或用户资料；最多保留最近 40 个历史条目。
const STORAGE_KEY = 'nh-discover-scroll-v1'
const MAX_ENTRIES = 40
const positions = new Map()

function readPosition(key) {
  if (positions.has(key)) return positions.get(key)
  try {
    const entries = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(entries)) return null
    // 刷新后一起保留其余历史条目，避免写入当前页时覆盖用户仍可后退到的旧位置。
    for (const entry of entries.slice(-MAX_ENTRIES)) {
      if (!Array.isArray(entry)) continue
      const [entryKey, value] = entry
      if (typeof entryKey === 'string' && Number.isFinite(value?.y) && value.y >= 0
        && Number.isInteger(value.pages) && value.pages > 0 && value.pages <= 50 && !positions.has(entryKey)) {
        positions.set(entryKey, value)
      }
    }
    while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value)
    return positions.get(key) || null
  } catch { /* 禁用存储或缓存损坏时仍可正常浏览。 */ }
  return null
}

function writePosition(key, value) {
  positions.delete(key)
  positions.set(key, value)
  while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value)
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...positions]))
  } catch { /* 隐私模式/存储配额不足时退化为当前页面内存。 */ }
}

/**
 * 按账号、筛选 URL 和历史条目恢复发现页位置，避免详情返回或刷新后被骨架高度截断。
 * ready 只在真实查询数据就绪时为 true；需要时顺序补回已浏览页，错误时停止补页。
 * 返回恢复中标记，调用方暂缓触底加载，防止它与恢复补页竞争。
 */
export function useDiscoverScroll({ entryKey, viewerId, search, ready, pageCount, hasNextPage, fetchNextPage, isFetching, isError }) {
  const key = `${viewerId || 'guest'}:${entryKey}:${search}`
  const restoration = useRef(null)
  const [restoreState, setRestoreState] = useState({ key, done: false })
  // A → 尚未完成的 B → A 时，不能沿用上一次 A 的完成标记，否则哨兵会在位置恢复前抢先翻页。
  if (restoreState.key !== key) setRestoreState({ key, done: false })

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])

  useLayoutEffect(() => {
    if (restoration.current?.key !== key) {
      restoration.current = { key, saved: readPosition(key), done: false }
    }
    const current = restoration.current
    if (current.done || !ready) return undefined
    if (current.saved?.pages > pageCount && hasNextPage) {
      // 失败时保留原来的深处目标，等待用户点重试；不能把较短列表的截断坐标记为已恢复。
      if (!isError && !isFetching) fetchNextPage().catch(() => {})
      return undefined
    }
    let secondFrame
    // 瀑布流会在测量列宽后再渲染一次，等两帧再跳转，避免先被短骨架截断位置。
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (restoration.current !== current || current.done) return
        const top = current.saved?.y || 0
        try {
          window.scrollTo({ top, left: 0, behavior: 'instant' })
        } catch {
          window.scrollTo(0, top)
        }
        current.position = { y: window.scrollY || document.scrollingElement?.scrollTop || 0, pages: Math.min(50, Math.max(1, pageCount)) }
        current.done = true
        setRestoreState({ key, done: true })
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame != null) cancelAnimationFrame(secondFrame)
    }
  }, [key, ready, pageCount, hasNextPage, fetchNextPage, isFetching, isError])

  useLayoutEffect(() => {
    // 提前记录用户看到的位置：卸载时旧 DOM 可能已缩短，现场读取会得到被浏览器截断的坐标。
    const track = () => {
      if (restoration.current?.key !== key || !restoration.current.done) return
      const y = window.scrollY || document.scrollingElement?.scrollTop || 0
      restoration.current.position = { y, pages: Math.min(50, Math.max(1, pageCount)) }
    }
    if (restoration.current?.key === key && restoration.current.position) {
      restoration.current.position.pages = Math.min(50, Math.max(1, pageCount))
    }
    const save = () => {
      if (restoration.current?.key === key && restoration.current.done && restoration.current.position) {
        writePosition(key, restoration.current.position)
      }
    }
    const pageHide = () => { track(); save() }
    const takeOver = (event) => {
      const current = restoration.current
      if (!ready || current?.key !== key || current.done || !current.saved) return
      if (event.type === 'keydown') {
        if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }
      // 用户已开始自行阅读，停止后续补页/跳转；在途请求可以完成，但不得把视口拉回旧目标。
      current.done = true
      track()
      setRestoreState({ key, done: true })
    }
    window.addEventListener('scroll', track, { passive: true })
    window.addEventListener('pointerdown', track, { capture: true, passive: true })
    window.addEventListener('keydown', track, true)
    window.addEventListener('pagehide', pageHide)
    window.addEventListener('wheel', takeOver, { passive: true })
    window.addEventListener('touchmove', takeOver, { passive: true })
    window.addEventListener('keydown', takeOver)
    return () => {
      save()
      window.removeEventListener('scroll', track)
      window.removeEventListener('pointerdown', track, true)
      window.removeEventListener('keydown', track, true)
      window.removeEventListener('pagehide', pageHide)
      window.removeEventListener('wheel', takeOver)
      window.removeEventListener('touchmove', takeOver)
      window.removeEventListener('keydown', takeOver)
    }
  }, [key, pageCount, ready])

  return restoreState.key !== key || !restoreState.done
}
