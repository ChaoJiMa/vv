import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useAuth } from '../../hooks/useAuth'
import { coverAspectRatio, coverKey } from '../../utils/image'
import { clampAspect } from '../../utils/imageAspect'
import { resolveAvatarUrl } from '../../utils/avatar'
import { HeartIcon, MenuSticker } from '../icons'
import { formatRelativeTime, getTypeTheme, typePillStyle } from '../../utils/typeTheme'

function readLiked(post) {
  return !!(post.viewer?.liked ?? post.my_liked ?? post.myLiked)
}

function readLikeCount(post) {
  return Number(post.stats?.likeCount ?? post.like_count) || 0
}

/**
 * 帖子入口：有图保留封面，无图以标题和摘要为主；只显示接口已经公开的地点。
 * 主内容使用原生链接，点赞为同级按钮，避免键盘操作点赞时误触详情导航。
 * variant="candy" 仅由首页开启；卡面保持统一中性色，分类色只用于左上角标签。
 * 角色仍在分类头区自然排版，colWidth 与瀑布估高共用，不因配色变化调整布局。
 */
export default function PostCard({ post, menu, onClick, aspect, colWidth = 160, priority = false, variant = 'default' }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const thumb = coverKey(post)
  const closed = post.status === 'closed'
  const theme = getTypeTheme(post.type, menu)
  const candy = variant === 'candy'
  const characterSize = colWidth < 150 ? 64 : 72
  const time = formatRelativeTime(post.createdAt ?? post.created_at)
  const nickname = (post.author?.nickname || post.nickname || '').trim() || '邻居'
  const avatarSrc = resolveAvatarUrl(post.author?.avatar ?? post.avatar)
  const initial = nickname === '邻居' ? '邻' : (nickname[0] || '邻')
  const summary = typeof post.content === 'string' ? post.content.replace(/\s+/g, ' ').trim() : ''
  const publicLocation = typeof post.location === 'string' ? post.location.trim() : ''
  const coverAspect = clampAspect(aspect ?? coverAspectRatio(post) ?? 1)

  const [likeOverride, setLikeOverride] = useState(null)
  const likeKey = `${user?.id || 'guest'}:${post.id}`
  const [likePostId, setLikePostId] = useState(likeKey)
  const [liking, setLiking] = useState(false)
  if (likePostId !== likeKey) {
    setLikePostId(likeKey)
    setLikeOverride(null)
  }
  const liked = likeOverride ? likeOverride.liked : readLiked(post)
  const likeCount = likeOverride ? likeOverride.count : readLikeCount(post)

  const onToggleLike = async () => {
    if (!user) {
      navigate('/login')
      return
    }
    if (liking) return
    setLiking(true)
    const prevLiked = liked
    const prevCount = likeCount
    setLikeOverride({ liked: !prevLiked, count: Math.max(0, prevCount + (prevLiked ? -1 : 1)) })
    try {
      const data = prevLiked ? await api.unlikePost(post.id) : await api.likePost(post.id)
      setLikeOverride({
        liked: !!data.liked,
        count: Number(data.likeCount ?? data.like_count) || 0,
      })
    } catch {
      setLikeOverride({ liked: prevLiked, count: prevCount })
    } finally {
      setLiking(false)
    }
  }

  const badges = (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', maxWidth: '100%', ...(candy && !thumb ? { flex: '0 0 auto' } : {}) }}>
      <span style={{
        ...typePillStyle(theme), fontSize: 11.5, padding: '5px 8px',
        ...(candy && !thumb ? {
          maxWidth: '100%',
          overflowWrap: 'anywhere', boxShadow: 'inset 0 1px 0 var(--color-material-highlight)',
        } : {}),
      }}>{theme.label}</span>
      {closed ? (
        <span style={{
          ...typePillStyle(theme), fontSize: 11.5, padding: '5px 8px',
          background: 'rgba(80,80,80,.8)', color: '#fff',
        }}>
          已结束
        </span>
      ) : null}
    </div>
  )

  return (
    <article
      className={`nh-postcard${candy ? ' nh-postcard--candy' : ''}`}
      style={{
        position: 'relative', width: '100%', textAlign: 'left', borderRadius: candy ? 20 : 18,
        // 首页统一实色卡面，分类只在标签上区分；其余页面沿用已有轻光泽。
        backgroundColor: 'var(--color-surface)',
        backgroundImage: candy ? 'none' : `linear-gradient(145deg, color-mix(in srgb, ${theme.pillBg} 24%, var(--color-surface)), var(--color-surface) 44%)`,
        overflow: 'hidden',
        // 内描边不占内容宽度，避免双列卡因实体边框而出现新的换行。
        boxShadow: candy
          ? 'inset 0 0 0 1px var(--color-border), inset 0 1px 0 var(--color-material-highlight), var(--shadow-card)'
          : `inset 0 0 0 1px ${theme.pillBg}, inset 0 1px 0 var(--color-material-highlight), var(--shadow-card)`,
      }}
    >
      <a
        href={`/note/${encodeURIComponent(post.id)}`}
        aria-label={`查看帖子：${post.title}`}
        className="nh-postcard-link"
        onClick={(e) => {
          // 保留链接的中键、修饰键新标签行为；普通点击继续走页面提供的路由回调。
          if (!onClick || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          onClick(e)
        }}
        style={{ display: 'block', color: 'inherit', textDecoration: 'none', WebkitTapHighlightColor: 'transparent' }}
      >
        {thumb ? (
          <div style={{ position: 'relative', width: '100%', aspectRatio: 1 / coverAspect }}>
            <img
              src={api.imgUrl(thumb)}
              alt=""
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                // 首页照片加载占位也保持中性，避免尚未加载时像整块分类色背景。
                objectFit: 'cover', display: 'block', background: candy ? 'var(--color-bg)' : 'var(--color-bg-accent)',
              }}
            />
            {closed ? <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--color-bg) 45%, transparent)' }} /> : null}
            <div style={{ position: 'absolute', left: 8, right: 8, top: 8 }}>{badges}</div>
          </div>
        ) : null}

        <div style={{ padding: 12 }}>
          {!thumb ? (
            <div className={candy ? 'nh-postcard-candy-head' : undefined} style={{
              marginBottom: 10,
              ...(candy ? {
                display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                justifyContent: 'space-between', minHeight: 72,
              } : {}),
            }}>
              {badges}
              {candy ? (
                // 窄列和长分类自然换行，让大角色与标签各有位置；不压住正文或照片。
                <span aria-hidden style={{ display: 'flex', flex: `1 0 ${characterSize}px`, justifyContent: 'flex-end', pointerEvents: 'none' }}>
                  <MenuSticker type={post.type} size={characterSize} style={{ '--gummy-scale': 1 }} />
                </span>
              ) : null}
            </div>
          ) : null}
          <h3 style={{
            ...clampedText, margin: 0, fontSize: 15.5, fontWeight: 700,
            color: 'var(--color-text)', lineHeight: 1.4, WebkitLineClamp: 2,
          }}>
            {post.title}
          </h3>
          {!thumb && summary ? (
            <p style={{
              ...clampedText, margin: '8px 0 0', fontSize: 13,
              color: 'var(--color-text-muted)', lineHeight: 1.5, WebkitLineClamp: 3,
            }}>
              {summary}
            </p>
          ) : null}
          {publicLocation ? (
            <div style={{
              marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              地点 · {publicLocation}
            </div>
          ) : null}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, paddingRight: 48 }}>
            <span className="nh-postcard-avatar" style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, background: candy ? 'var(--color-bg)' : theme.pillBg,
              boxShadow: candy ? 'inset 0 0 0 1px var(--color-material-highlight)' : undefined,
              color: candy ? 'var(--color-text-muted)' : theme.pillFg, overflow: 'hidden',
            }}>
              {avatarSrc ? <img src={avatarSrc} alt="" loading="lazy" decoding="async" width={22} height={22} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, lineHeight: 1.4, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nickname}
              </span>
              {time ? <span style={{ display: 'block', marginTop: 2, fontSize: 11, lineHeight: 1.3, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{time}</span> : null}
            </span>
          </div>
        </div>
      </a>
      <button
        type="button"
        aria-label={liked ? '取消点赞' : '点赞'}
        aria-pressed={liked}
        disabled={liking}
        onClick={onToggleLike}
        style={{
          position: 'absolute', right: 8, bottom: 12, minWidth: 44, minHeight: 44,
          border: 'none', borderRadius: 10, padding: '4px', background: 'transparent',
          cursor: liking ? 'wait' : 'pointer', display: 'inline-flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          color: liked ? 'var(--color-primary)' : 'var(--color-text-muted)',
          fontSize: 12, fontWeight: 600, lineHeight: 1,
        }}
      >
        <HeartIcon size={18} filled={liked} />
        {likeCount > 0 ? (likeCount > 999 ? '999+' : likeCount) : ''}
      </button>
      <style>{`
        .nh-postcard-link:active { opacity: .82; }
        .nh-postcard-link:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -3px; }
        /* 首页按压只增加中性高光，不改变链接或点赞热区。 */
        .nh-postcard--candy .nh-postcard-link:active { opacity: 1; }
        .nh-postcard--candy::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: inset 0 0 0 2px var(--color-material-highlight);
          opacity: 0;
          pointer-events: none;
        }
        .nh-postcard--candy:active::after { opacity: 1; }
        .nh-postcard-avatar { display: inline-flex; }
        /* 窄屏双列优先展示昵称和时间，隐藏头像，把空间留给文字与 44px 点赞热区。 */
        @media (max-width: 360px) {
          .nh-postcard-avatar { display: none; }
        }
      `}</style>
    </article>
  )
}

const clampedText = {
  display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere',
}
