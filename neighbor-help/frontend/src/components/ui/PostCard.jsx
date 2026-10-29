import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useAuth } from '../../hooks/useAuth'
import { coverAspectRatio, coverKey } from '../../utils/image'
import { clampAspect, NO_IMAGE_ASPECT } from '../../utils/imageAspect'
import { resolveAvatarUrl } from '../../utils/avatar'
import { HeartIcon } from '../icons'
import {
  formatRelativeTime, getTypeTheme, timeBadgeStyle, typePillStyle,
} from '../../utils/typeTheme'

function readLiked(post) {
  return !!(post.viewer?.liked ?? post.my_liked ?? post.myLiked)
}

function readLikeCount(post) {
  return Number(post.stats?.likeCount ?? post.like_count) || 0
}

export default function PostCard({ post, menu, onClick, aspect }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const thumb = coverKey(post)
  const closed = post.status === 'closed'
  const theme = getTypeTheme(post.type, menu)
  const time = formatRelativeTime(post.createdAt ?? post.created_at)
  const nickname = (post.author?.nickname || post.nickname || '').trim() || '邻居'
  const avatarSrc = resolveAvatarUrl(post.author?.avatar ?? post.avatar)
  const initial = nickname === '邻居' ? '邻' : (nickname[0] || '邻')
  const knownAspect = coverAspectRatio(post)
  const coverAspect = clampAspect(
    aspect ?? (knownAspect != null ? knownAspect : (thumb ? 1 : NO_IMAGE_ASPECT))
  )

  const [likeOverride, setLikeOverride] = useState(null)
  const [likePostId, setLikePostId] = useState(post.id)
  const [liking, setLiking] = useState(false)
  if (likePostId !== post.id) {
    setLikePostId(post.id)
    setLikeOverride(null)
  }
  const liked = likeOverride ? likeOverride.liked : readLiked(post)
  const likeCount = likeOverride ? likeOverride.count : readLikeCount(post)

  const onToggleLike = async (e) => {
    e.stopPropagation()
    e.preventDefault()
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

  // CSS aspect-ratio = width/height；coverAspect 为 h/w
  const cssRatio = 1 / coverAspect

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(e)
        }
      }}
      className="nh-postcard"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 12,
        background: 'var(--color-surface)',
        boxShadow: '0 4px 14px color-mix(in srgb, var(--color-text) 7%, transparent)',
        overflow: 'hidden',
        padding: 0,
        transition: 'transform var(--motion-duration, 0.15s) ease',
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.985)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = '' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: cssRatio }}>
        {thumb ? (
          <img
            src={api.imgUrl(thumb)}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              background: 'var(--color-bg-accent)',
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: theme.cover,
              overflow: 'hidden',
            }}
          >
            <span style={{
              position: 'absolute', top: -20, right: -12, width: 72, height: 72,
              borderRadius: '50%', background: 'rgba(255,255,255,.28)',
            }} />
            <span style={{
              position: 'absolute', bottom: -24, left: 12, width: 56, height: 56,
              borderRadius: '50%', background: 'rgba(255,255,255,.2)',
            }} />
          </div>
        )}

        {closed ? (
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              background: 'color-mix(in srgb, var(--color-bg) 45%, transparent)',
            }}
          />
        ) : null}

        <div style={{
          position: 'absolute', left: 8, top: 8,
          display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
          maxWidth: '70%',
        }}>
          <span style={{ ...typePillStyle(theme), fontSize: 10, padding: '4px 7px' }}>{theme.label}</span>
          {closed ? (
            <span style={{
              ...typePillStyle(theme),
              fontSize: 10,
              padding: '4px 7px',
              background: 'rgba(80,80,80,.75)',
              color: '#fff',
            }}>
              已结束
            </span>
          ) : null}
        </div>

        {time ? (
          <span style={{
            position: 'absolute', right: 8, top: 8,
            ...timeBadgeStyle,
            fontSize: 10,
            padding: '4px 7px',
          }}>
            {time}
          </span>
        ) : null}
      </div>

      <div style={{ padding: '10px 10px 10px' }}>
        <h3 style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--color-text)',
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {post.title}
        </h3>

        <div style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            background: theme.pillBg,
            color: theme.pillFg,
            overflow: 'hidden',
          }}>
            {avatarSrc ? (
              <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : initial}
          </span>
          <span style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {nickname}
          </span>
          <button
            type="button"
            aria-label={liked ? '取消点赞' : '点赞'}
            aria-pressed={liked}
            onClick={onToggleLike}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '2px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              color: liked ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontSize: 11,
              fontWeight: 600,
              minHeight: 24,
            }}
          >
            <HeartIcon size={14} filled={liked} />
            {likeCount > 0 ? likeCount : ''}
          </button>
        </div>
      </div>
    </article>
  )
}
