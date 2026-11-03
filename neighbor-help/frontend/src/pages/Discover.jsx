import { useState, useEffect, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation, useSearchParams, useNavigationType } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import {
  AppShell, Button, CategoryStrip, PostCard, PostFeed, StickyHeader,
} from '../components/ui'
import { CloseIcon, SearchIcon } from '../components/icons'
import { EmptyPosts, EmptySearch } from '../components/illustrations/EmptyArts'
import { useDiscoverScroll } from '../hooks/useDiscoverScroll'
import PageTitle from '../components/ui/PageTitle'

export default function Discover() {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  // 已提交条件以 URL 为准，刷新、分享与详情返回均使用同一份查询状态。
  const activeTab = params.get('type') || ''
  const keyword = (params.get('keyword') || '').trim()
  const [searchDraft, setSearchDraft] = useState({ keyword, text: keyword })
  const search = searchDraft.keyword === keyword ? searchDraft.text : keyword
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
    isPlaceholderData, isFetching, isFetchNextPageError, isRefetchError,
  } = useInfiniteQuery({
    queryKey: ['posts', activeTab, keyword, user?.id],
    queryFn: ({ pageParam }) => api.getPosts(activeTab, pageParam, keyword),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    placeholderData: (previous, query) => query?.queryKey[3] === user?.id ? previous : undefined,
  })
  const posts = data?.pages.flatMap(p => p.list) ?? []
  const restoringScroll = useDiscoverScroll({
    entryKey: location.key,
    viewerId: user?.id,
    search: location.search,
    ready: !!data && !isPlaceholderData,
    pageCount: data?.pages.length || 0,
    hasNextPage,
    fetchNextPage,
    isFetching,
    isError,
  })

  /** 只更新本页条件，保留其它查询参数；新历史条目从顶部开始，返回则还原旧位置。 */
  const updateFilters = (type, word) => {
    const next = new URLSearchParams(params)
    if (type) next.set('type', type)
    else next.delete('type')
    if (word) next.set('keyword', word)
    else next.delete('keyword')
    if (next.toString() !== params.toString()) setParams(next)
  }

  const submitSearch = () => {
    const next = search.trim()
    updateFilters(activeTab, next)
    setSearchDraft({ keyword: next, text: next })
    setSearchOpen(false)
  }
  const clearSearch = () => {
    updateFilters(activeTab, '')
    setSearchDraft({ keyword: '', text: '' })
    setSearchOpen(false)
  }

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const toggleSearch = () => {
    if (!searchOpen) setSearchDraft({ keyword, text: keyword })
    setSearchOpen(open => !open)
  }

  return (
    <AppShell withNav>
      <StickyHeader style={{ padding: 'calc(var(--page-heading-top) + var(--safe-top)) 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: 'var(--page-heading-height)', gap: 8 }}>
          <PageTitle>发现</PageTitle>
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
        </div>

        {searchOpen && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <div style={{
              // 两层flex均允许收缩到输入内容以下，避免窄屏被input默认固有宽度撑开。
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--color-surface)', border: '1.5px solid var(--color-border)',
              borderRadius: 999, padding: '0 12px', minHeight: 44,
            }}>
              <SearchIcon size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                value={search}
                onChange={e => setSearchDraft({ keyword, text: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitSearch() }}
                aria-label="搜索标题或内容"
                placeholder="搜索标题或内容"
                style={{
                  flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                  color: 'var(--color-text)', fontSize: 14, minHeight: 40,
                }}
              />
              {search ? (
                <button
                  type="button"
                  aria-label="清除搜索"
                  onClick={clearSearch}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted)', flexShrink: 0 }}
                >
                  <CloseIcon size={16} />
                </button>
              ) : null}
            </div>
            <Button type="button" onClick={submitSearch} style={{ borderRadius: 999, minWidth: 64, flexShrink: 0 }}>
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
          onSelect={type => updateFilters(type, keyword)}
        />
        {isPlaceholderData && (
          <div role="status" style={{ paddingTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            正在更新筛选结果…
          </div>
        )}
      </StickyHeader>

      <PostFeed
        key={`${activeTab}|${keyword}`}
        style={{ padding: '12px 16px 24px' }}
        feedClassName={`nh-discover-panel${navigationType === 'POP' ? ' nh-discover-return' : ''}`}
        items={posts}
        isLoading={isLoading || isPlaceholderData}
        isError={isError}
        isFetchNextPageError={isFetchNextPageError}
        isRefetchError={isRefetchError}
        isFetching={isFetching}
        onRetry={() => refetch()}
        hasNextPage={hasNextPage}
        autoLoadEnabled={!isPlaceholderData && !restoringScroll}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        empty={{
          illustration: keyword ? <EmptySearch /> : <EmptyPosts />,
          title: keyword ? '没有找到相关帖子' : '这里还空着',
          description: keyword ? '试试其他关键词' : '去首页发布第一条吧',
          actionLabel: keyword ? undefined : '去首页',
          onAction: keyword ? undefined : () => navigate('/'),
        }}
        renderItem={(post, { aspect, priority }) => (
          <PostCard
            post={post}
            menu={menuMap[post.type]}
            aspect={aspect}
            priority={priority}
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
        /* 历史返回直接显示原列表，避免错峰入场把已恢复位置的卡片暂时隐藏。 */
        .nh-discover-return,
        .nh-discover-return .nh-waterfall-card { animation: none; }
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
  width: 'var(--page-heading-height)',
  height: 'var(--page-heading-height)',
  flexShrink: 0,
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
