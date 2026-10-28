import { api } from '../../api'
import { safeParse } from '../../utils/image'
import Sticker from './Sticker'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(typeof ts === 'number' ? ts : Number(ts))
  if (Number.isNaN(d.getTime())) return ''
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function PostCard({ post, menu, onClick }) {
  const thumb = safeParse(post.images)[0]
  const closed = post.status === 'closed'

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
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 'var(--radius-card)',
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-card)',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'var(--color-border)',
        padding: 14,
        marginBottom: 12,
        transition: 'transform var(--motion-duration) ease',
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = '' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {menu?.label ? (
          <Sticker active={false} color="cream" style={{ minHeight: 28, padding: '4px 10px', fontSize: 12, pointerEvents: 'none' }}>
            {menu.icon ? `${menu.icon} ` : ''}{menu.label}
          </Sticker>
        ) : null}
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: closed ? 'var(--color-text-muted)' : 'var(--color-primary)',
          background: closed ? 'var(--color-bg-accent)' : 'var(--color-bg-accent)',
          padding: '2px 8px',
          borderRadius: 999,
        }}>
          {closed ? '已结束' : '进行中'}
        </span>
      </div>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.35 }}>
        {post.title}
      </h3>
      {post.content ? (
        <p style={{
          margin: '0 0 10px',
          fontSize: 13,
          color: 'var(--color-text-muted)',
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {post.content}
        </p>
      ) : null}
      {thumb ? (
        <img
          src={api.imgUrl(thumb)}
          alt=""
          style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 12, marginBottom: 10, display: 'var(--color-bg-accent)' }}
        />
      ) : null}
      <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
        {post.location ? <span>{post.location}</span> : null}
        <span>{formatTime(post.created_at)}</span>
        {typeof post.comment_count === 'number' ? <span>{post.comment_count} 评</span> : null}
      </div>
    </article>
  )
}
