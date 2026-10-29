import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import HomeTop from '../components/home/HomeTop'
import {
  AppShell, Fab, PostCard, PostFeed, SectionHeader, Sheet,
} from '../components/ui'
import { HelpIcon } from '../components/icons'
import { EmptyPosts } from '../components/illustrations/EmptyArts'

const NOTICES_FALLBACK = [
  '欢迎来到邻里里,远亲不如近邻',
  '文明互助,共建友善社区',
  '交易注意安全,谨防诈骗',
]

const SAFETY_TIPS_FALLBACK = [
  { icon: '🔒', text: '见面交易选在小区公共区域,结伴更安心' },
  { icon: '💰', text: '大额交易当面验货,警惕预付定金类骗局' },
  { icon: '📵', text: '不向陌生人透露验证码、银行卡等敏感信息' },
  { icon: '🤝', text: '文明互助、理性沟通,共建友善邻里关系' },
]

export default function Home() {
  const [helpOpen, setHelpOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })
  const menuMap = Object.fromEntries(menus.map(m => [m.value, m]))

  const { data: ann } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.getAnnouncements(),
    staleTime: 5 * 60 * 1000,
  })
  const notices = ann?.notices?.length ? ann.notices : NOTICES_FALLBACK
  const safetyTips = ann?.safetyTips?.length ? ann.safetyTips : SAFETY_TIPS_FALLBACK
  const noticeSummary = notices[0] || ''

  const {
    data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['posts', '', ''],
    queryFn: ({ pageParam }) => api.getPosts('', pageParam, ''),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
  })
  const posts = data?.pages.flatMap(p => p.list) ?? []
  const total = data?.pages?.[0]?.total ?? 0
  const todayCount = posts.filter(p => isToday(p.createdAt ?? p.created_at)).length
  const hotTodayByType = {}
  for (const p of posts) {
    if (isToday(p.createdAt ?? p.created_at)) hotTodayByType[p.type] = true
  }

  return (
    <AppShell withNav>
      <HomeTop
        user={user}
        todayCount={todayCount}
        total={total}
        noticeSummary={noticeSummary}
        onNoticeClick={() => setNoticeOpen(true)}
        onLogin={() => navigate('/login')}
        menus={menus}
        hotByType={hotTodayByType}
        onPickCategory={(value) => navigate('/discover', { state: { type: value } })}
      />

      <SectionHeader
        title="邻里动态"
        action={(
          <button
            type="button"
            onClick={() => navigate('/discover')}
            style={{ ...ghostBtn, color: 'var(--color-primary)' }}
          >
            全部
          </button>
        )}
      />

      <PostFeed
        style={{ padding: '0 16px 24px' }}
        items={posts}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        feedClassName="nh-home-feed"
        empty={{
          title: '还没有邻居动态',
          description: '发布第一个求助,让邻居帮你!',
          actionLabel: '发布求助',
          onAction: () => navigate('/create'),
          illustration: <EmptyPosts />,
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

      <style>{`
        .nh-home-feed {
          animation: nhHomeFeedIn 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes nhHomeFeedIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-home-feed { animation: none !important; }
        }
      `}</style>

      <Fab
        ariaLabel="新手必读"
        onClick={() => setHelpOpen(true)}
        style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
      >
        <HelpIcon size={22} />
      </Fab>

      <Sheet open={noticeOpen} onClose={() => setNoticeOpen(false)} title="小区公告" heightVh={42}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notices.map((n, i) => (
            <div
              key={i}
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: 'var(--color-bg-accent)',
                fontSize: 13.5,
                lineHeight: 1.55,
                color: 'var(--color-text)',
              }}
            >
              {n}
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="新手必读 · 安全提示" heightVh={48}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {safetyTips.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <span style={{ fontSize: 13.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t.text}</span>
            </div>
          ))}
        </div>
      </Sheet>

      <BottomNav />
    </AppShell>
  )
}

const ghostBtn = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 36,
  padding: '4px 8px',
}

function isToday(ts) {
  const d = new Date(ts)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}
