import EmptyState from './EmptyState'
import ListError from './ListError'
import Waterfall from './Waterfall'
import WaterfallSkeleton from './WaterfallSkeleton'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'
import Button from './Button'

/**
 * 帖子瀑布列表：加载骨架 / 错误 / 空态 / 列表 / 触底加载
 * @param {object} empty - EmptyState props（无数据时）
 * @param {function} renderItem - (item, { aspect, priority }) => ReactNode
 * @param {boolean} isFetchNextPageError - 下一页失败时停下自动加载，由用户明确重试。
 * @param {boolean} isRefetchError - 后台刷新失败时保留现有列表并提供刷新入口。
 * @param {boolean} autoLoadEnabled - 临时暂停触底加载，独立于服务端是否还有下一页。
 * @param {'default'|'candy'} cardVariant - 仅同步卡内估高；卡片实际外观仍由 renderItem 决定。
 * @param {object} cardMenus - 分类值到菜单的映射，使自定义标签与实际卡片采用相同估高输入。
 */
export default function PostFeed({
  items = [],
  isLoading = false,
  isError = false,
  isFetchNextPageError = false,
  isRefetchError = false,
  isFetching = false,
  autoLoadEnabled = true,
  onRetry,
  empty,
  renderItem,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  feedKey,
  feedClassName,
  cardVariant = 'default',
  cardMenus,
  style,
}) {
  const list = items
  const showList = list.length > 0
  // 已有占位数据时不盖骨架（配合 keepPreviousData）
  const showSkeleton = isLoading && !showList
  // 新调用方传入 Query 的具体错误阶段；旧调用方仍可通过 isError 获得恢复入口。
  const nextPageFailed = isFetchNextPageError || (isError && !isRefetchError && hasNextPage)
  const refreshFailed = isRefetchError || (isError && !nextPageFailed)
  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    // 出错后断开哨兵，避免失败 → 重绘 → 再触底形成自动重试循环。
    enabled: autoLoadEnabled && showList && !isError && !nextPageFailed && !isFetching && typeof fetchNextPage === 'function',
  })

  return (
    <div style={style}>
      {showSkeleton && <WaterfallSkeleton />}
      {!showSkeleton && isError && !showList && <ListError onRetry={onRetry} />}
      {!showSkeleton && !isError && !showList && empty && (
        <EmptyState {...empty} />
      )}
      {showList && refreshFailed && (
        <div role="status" style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>刷新失败，已保留当前内容</p>
          <Button variant="secondary" loading={isFetching} onClick={onRetry}>重试刷新</Button>
        </div>
      )}
      {showList && (
        <div key={feedKey} className={feedClassName}>
          <Waterfall items={list} renderItem={renderItem} cardVariant={cardVariant} cardMenus={cardMenus} />
        </div>
      )}
      {showList && (
        <div
          ref={sentinelRef}
          style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 12 }}
        >
          {nextPageFailed ? (
            <div role="status">
              <p style={{ margin: '0 0 8px' }}>加载更多失败，已有内容已保留</p>
              <Button variant="secondary" loading={isFetchingNextPage} disabled={isFetching && !isFetchingNextPage} onClick={() => fetchNextPage?.()}>重试加载更多</Button>
            </div>
          ) : isFetchingNextPage ? '加载中…' : !hasNextPage ? '没有更多了' : ''}
        </div>
      )}
    </div>
  )
}
