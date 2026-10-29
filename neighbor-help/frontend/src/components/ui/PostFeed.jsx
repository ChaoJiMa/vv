import EmptyState from './EmptyState'
import ListError from './ListError'
import Waterfall from './Waterfall'
import WaterfallSkeleton from './WaterfallSkeleton'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'

/**
 * 帖子瀑布列表：加载骨架 / 错误 / 空态 / 列表 / 触底加载
 * @param {object} empty - EmptyState props（无数据时）
 * @param {function} renderItem - (item, { aspect }) => ReactNode
 */
export default function PostFeed({
  items = [],
  isLoading = false,
  isError = false,
  onRetry,
  empty,
  renderItem,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  feedKey,
  feedClassName,
  style,
}) {
  const list = items
  const showList = list.length > 0
  // 已有占位数据时不盖骨架（配合 keepPreviousData）
  const showSkeleton = isLoading && !showList
  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    enabled: showList && typeof fetchNextPage === 'function',
  })

  return (
    <div style={style}>
      {showSkeleton && <WaterfallSkeleton />}
      {!showSkeleton && isError && !showList && <ListError onRetry={onRetry} />}
      {!showSkeleton && !isError && !showList && empty && (
        <EmptyState {...empty} />
      )}
      {showList && (
        <div key={feedKey} className={feedClassName}>
          <Waterfall items={list} renderItem={renderItem} />
        </div>
      )}
      {showList && (
        <div
          ref={sentinelRef}
          style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 12 }}
        >
          {isFetchingNextPage ? '加载中…' : !hasNextPage ? '没有更多了' : ''}
        </div>
      )}
    </div>
  )
}
