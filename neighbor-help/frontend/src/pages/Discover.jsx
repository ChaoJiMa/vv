import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import {
  AppShell, Button, CategoryStrip, PostCard, PostFeed, StickyHeader,
} from '../components/ui'
import { CloseIcon, SearchIcon } from '../components/icons'
import { EmptyPosts, EmptySearch } from '../components/illustrations/EmptyArts'
import { scrollToTop } from '../utils/scrollToTop'

export default function Discover() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState(location.state?.type || '')
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef(null)

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
    placeholderData: keepPreviousData,
  })
  const posts = data?.pages.flatMap(p => p.list) ?? []

  const submitSearch = () => {
    const next = search.trim()
    setKeyword(next)
    if (!next) setSearchOpen(false)
  }
  const clearSearch = () => {
    setSearch('')
    setKeyword('')
    setSearchOpen(false)
  }

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useLayoutEffect(() => {
    scrollToTop()
  }, [activeTab, keyword])

  const toggleSearch = () => {
    if (searchOpen && !keyword) {
      setSearchOpen(false)
      setSearch('')
      return
    }
    setSearchOpen(true)
  }

  return (
    <AppShell withNav>
      <StickyHeader style={{ padding: 'calc(12px + var(--safe-top)) 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>
            发现
          </h1>
          <button
            type="button"
            aria-label={searchOpen ? '收起搜索' : '搜索'}
            aria-expanded={searchOpen}
            onClick={toggleSearch}
            style={{
              ...iconBtn,
              color: searchOpen || keyword ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: searchOpen || keyword ? 'var(--color-bg-accent)' : 'transparent',
            }}
          >
            <SearchIcon size={20} />
          </button>
          {!user && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/login')}
              style={{ minHeight: 36, padding: '6px 14px' }}
            >
              登录
            </Button>
          )}
        </div>

        {searchOpen && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--color-surface)', border: '1.5px solid var(--color-border)',
              borderRadius: 999, padding: '0 12px', minHeight: 44,
            }}>
              <SearchIcon size={18} style={{ color: 'var(--color-text-muted)' }} />
              <input
                ref={searchInputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitSearch() }}
                placeholder="搜索标题或内容"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  color: 'var(--color-text)', fontSize: 14, minHeight: 40,
                }}
              />
              {search ? (
                <button
                  type="button"
                  aria-label="清除输入"
                  onClick={() => setSearch('')}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted)' }}
                >
                  <CloseIcon size={16} />
                </button>
              ) : null}
            </div>
            <Button type="button" onClick={submitSearch} style={{ borderRadius: 999, minWidth: 64 }}>
              搜索
            </Button>
          </div>
        )}

        {keyword && !searchOpen && (
          <div style={{
            marginTop: 10, display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12.5, color: 'var(--color-text-muted)',
          }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              搜索「{keyword}」
            </span>
            <button type="button" onClick={clearSearch} style={linkBtn}>清除</button>
          </div>
        )}

        <CategoryStrip
          mode="filter"
          menus={menus}
          active={activeTab}
          onSelect={setActiveTab}
        />
      </StickyHeader>

      <PostFeed
        key={`${activeTab}|${keyword}`}
        style={{ padding: '12px 16px 24px' }}
        feedClassName="nh-discover-panel"
        items={posts}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        empty={{
          illustration: keyword ? <EmptySearch /> : <EmptyPosts />,
          title: keyword ? '没有找到相关帖子' : '这里还空着',
          description: keyword ? '试试其他关键词' : '去首页发布第一条吧',
          actionLabel: keyword ? undefined : '去首页',
          onAction: keyword ? undefined : () => navigate('/'),
        }}
        renderItem={(post, { aspect }) => (
          <PostCard
            post={post}
            menu={menuMap[post.type]}
            aspect={aspect}
            onClick={() => navigate(`/note/${post.id}`)}
          />
        )}
      />
      <BottomNav />

      <style>{`
        .nh-discover-cat {
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .nh-discover-panel {
          animation: nhDiscoverPanelIn 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes nhDiscoverPanelIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-discover-cat { transition: none !important; }
          .nh-discover-cat span { transition: none !important; }
          .nh-discover-panel { animation: none !important; }
        }
      `}</style>
    </AppShell>
  )
}

const iconBtn = {
  border: 'none',
  width: 40,
  height: 40,
  borderRadius: 12,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
}

const linkBtn = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-primary)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '2px 4px',
}
