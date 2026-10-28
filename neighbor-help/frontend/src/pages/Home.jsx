import { useState, useEffect, useRef, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineRounded'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import BottomNav from '../components/BottomNav'
import {
  AppShell, Button, EmptyState, Fab, ListError, PostCard, Sheet, Skeleton,
} from '../components/ui'

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

const ENTRY_COLORS = ['mint', 'sky', 'cream', 'primary']

export default function Home() {
  const [helpOpen, setHelpOpen] = useState(false)
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
  const todayCount = posts.filter(p => isToday(p.created_at)).length

  const hotByType = {}
  posts.forEach(p => { hotByType[p.type] = (hotByType[p.type] || 0) + 1 })

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

  const onPickCategory = (value) => navigate('/discover', { state: { type: value } })

  return (
    <AppShell withNav>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color: 'var(--color-primary)' }}>邻里里</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>远亲不如近邻</div>
        </div>
        <button
          type="button"
          aria-label="刷新"
          onClick={() => refetch()}
          style={ghostBtn}
        >
          刷新
        </button>
        {!user && (
          <Button type="button" variant="secondary" onClick={() => navigate('/login')} style={{ minHeight: 36, padding: '6px 14px' }}>
            登录
          </Button>
        )}
      </header>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        margin: '10px 16px 0', padding: '8px 12px',
        borderRadius: 14,
        background: 'var(--color-bg-accent)',
        overflow: 'hidden',
      }}>
        <CampaignOutlinedIcon sx={{ fontSize: 18, color: 'var(--color-primary)', flexShrink: 0 }} />
        <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <div className="nh-notice-marquee" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            {[...notices, ...notices].map((n, i) => (
              <span key={i} style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginRight: 28 }}>{n}</span>
            ))}
          </div>
        </div>
      </div>

      <section style={{
        margin: '14px 16px 0', padding: 18, borderRadius: 'var(--radius-card)', color: 'var(--color-on-primary)',
        background: 'linear-gradient(135deg, var(--color-primary) 0%, #FF8A6B 100%)',
        boxShadow: 'var(--shadow-card)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.16)' }} />
        <div style={{ fontSize: 13, opacity: 0.92, position: 'relative' }}>今日动态</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, position: 'relative' }}>
          <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{todayCount}</span>
          <span style={{ fontSize: 14, opacity: 0.92 }}>条新发布 · 社区累计 {total} 条</span>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, fontWeight: 600, position: 'relative' }}>
          有需要别自己扛,发一条让邻居搭把手
        </p>
        <Button
          type="button"
          onClick={() => navigate('/create')}
          style={{
            marginTop: 12, position: 'relative',
            background: 'rgba(255,255,255,0.95)', color: 'var(--color-primary-pressed)',
            boxShadow: 'none',
          }}
        >
          发布求助,让邻居帮你 <ArrowForwardIcon sx={{ fontSize: 18 }} />
        </Button>
      </section>

      <section style={{ padding: '18px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {menus.map((m, i) => {
          const hot = hotByType[m.value] || 0
          const tint = ENTRY_COLORS[i % ENTRY_COLORS.length]
          const bg = tint === 'primary' ? 'var(--color-bg-accent)' : `var(--color-accent-${tint})`
          return (
            <button
              key={m.value}
              type="button"
              className="nh-float-entry"
              onClick={() => onPickCategory(m.value)}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 10,
                padding: 14, borderRadius: 16, border: '1.5px solid var(--color-border)',
                background: bg, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left',
                minHeight: 72,
              }}
            >
              {hot > 0 ? (
                <span style={{
                  position: 'absolute', top: 8, right: 8, minWidth: 18, height: 18, padding: '0 5px',
                  borderRadius: 9, background: 'var(--color-primary)', color: 'var(--color-on-primary)',
                  fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{hot > 99 ? '99+' : hot}</span>
              ) : null}
              <span style={{ fontSize: 22 }}>{m.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{m.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hot > 0 ? `近期 ${hot} 条` : m.desc}
                </span>
              </span>
            </button>
          )
        })}
      </section>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 16px 8px' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>邻里动态</h2>
        <button type="button" onClick={() => navigate('/discover')} style={{ ...ghostBtn, color: 'var(--color-primary)' }}>全部浏览</button>
      </div>

      <div style={{ padding: '0 16px 24px' }}>
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {!isLoading && isError && <ListError onRetry={() => refetch()} />}
        {!isLoading && !isError && posts.length === 0 && (
          <EmptyState
            title="还没有邻居动态"
            description="发布第一个求助,让邻居帮你!"
            actionLabel="发布求助"
            onAction={() => navigate('/create')}
            emoji="📝"
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

      <Fab
        ariaLabel="新手必读"
        onClick={() => setHelpOpen(true)}
        style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
      >
        <HelpOutlineIcon />
      </Fab>

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

      <style>{`
        .nh-notice-marquee { animation: nhNotice 18s linear infinite; }
        .nh-notice-marquee:hover { animation-play-state: paused; }
        @keyframes nhNotice {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .nh-float-entry { animation: nhFloat 4.5s ease-in-out infinite; }
        .nh-float-entry:nth-child(2) { animation-delay: 0.4s; }
        .nh-float-entry:nth-child(3) { animation-delay: 0.8s; }
        .nh-float-entry:nth-child(4) { animation-delay: 1.2s; }
        @keyframes nhFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-notice-marquee, .nh-float-entry { animation: none !important; }
        }
      `}</style>
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
