import { useState, useEffect, useRef, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import {
  AppShell, Button, EmptyState, ListError, PostCard, Skeleton, Sticker,
} from '../components/ui'
import { CloseIcon, MenuIcon, SearchIcon } from '../components/icons'
import { EmptyPosts, EmptySearch } from '../components/illustrations/EmptyArts'

export default function Discover() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState(location.state?.type || '')
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const {
    data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['posts', activeTab, keyword],
    queryFn: ({ pageParam }) => api.getPosts(activeTab, pageParam, keyword),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const posts = data?.pages.flatMap(p => p.list) ?? []

  const submitSearch = () => setKeyword(search.trim())
  const clearSearch = () => { setSearch(''); setKeyword('') }

  const sentinelRef = useRef(null)
  const observe = useCallback((node) => {
    if (!node) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(node)
    return io
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  useEffect(() => {
    const io = observe(sentinelRef.current)
    return () => io?.disconnect()
  }, [observe])

  return (
    <AppShell withNav>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>发现</h1>
          <button type="button" onClick={() => refetch()} style={linkBtn}>刷新</button>
          {!user && (
            <Button type="button" variant="secondary" onClick={() => navigate('/login')} style={{ minHeight: 36, padding: '6px 14px', marginLeft: 8 }}>
              登录
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--color-surface)', border: '1.5px solid var(--color-border)',
            borderRadius: 999, padding: '0 12px', minHeight: 44,
          }}>
            <SearchIcon size={20} style={{ color: 'var(--color-text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitSearch() }}
              placeholder="搜索帖子标题或内容"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--color-text)', fontSize: 14, minHeight: 40,
              }}
            />
            {search ? (
              <button type="button" aria-label="清除" onClick={clearSearch} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted)' }}>
                <CloseIcon size={16} />
              </button>
            ) : null}
          </div>
          <Button type="button" onClick={submitSearch} style={{ borderRadius: 999, minWidth: 64 }}>搜索</Button>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingTop: 12, paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
          <Sticker active={activeTab === ''} onClick={() => setActiveTab('')}>全部</Sticker>
          {menus.map(m => (
            <Sticker key={m.value} active={activeTab === m.value} color="mint" onClick={() => setActiveTab(m.value)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <MenuIcon type={m.value} size={14} />{m.label}
              </span>
            </Sticker>
          ))}
        </div>
      </header>

      <div style={{ padding: '12px 16px 24px' }}>
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {!isLoading && isError && <ListError onRetry={() => refetch()} />}
        {!isLoading && !isError && posts.length === 0 && (
          <EmptyState
            illustration={keyword ? <EmptySearch /> : <EmptyPosts />}
            title={keyword ? '没有找到相关帖子' : '这里还空着'}
            description={keyword ? '试试其他关键词' : '去首页发布第一条吧'}
            actionLabel={keyword ? undefined : '去首页'}
            onAction={keyword ? undefined : () => navigate('/')}
          />
        )}
        {posts.map(post => (
          <PostCard
            key={post.id}
            post={post}
            menu={menuMap[post.type]}
            onClick={() => navigate(`/post/${post.id}`)}
          />
        ))}
        {posts.length > 0 && (
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {isFetchingNextPage ? '加载中…' : !hasNextPage ? '没有更多了' : ''}
          </div>
        )}
      </div>
      <BottomNav />
    </AppShell>
  )
}

const linkBtn = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 36,
}
