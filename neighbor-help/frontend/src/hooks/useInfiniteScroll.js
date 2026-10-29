import { useCallback, useEffect, useState } from 'react'

/**
 * 列表触底加载。返回 callback ref（勿用普通 ref），
 * 哨兵节点挂载/换新时会重新 observe，避免 PostFeed 重挂后失效。
 */
export function useInfiniteScroll({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  rootMargin = '200px',
  enabled = true,
}) {
  const [node, setNode] = useState(null)
  const sentinelRef = useCallback((el) => {
    setNode(el)
  }, [])

  useEffect(() => {
    if (!enabled || !node || typeof fetchNextPage !== 'function') return undefined
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }, { rootMargin })
    io.observe(node)
    return () => io.disconnect()
  }, [enabled, node, hasNextPage, isFetchingNextPage, fetchNextPage, rootMargin])

  return sentinelRef
}
