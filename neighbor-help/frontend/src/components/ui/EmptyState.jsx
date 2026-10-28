import Button from './Button'

export default function EmptyState({ title, description, actionLabel, onAction, emoji = '📝' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 52, marginBottom: 12 }} aria-hidden>{emoji}</div>
      {title ? (
        <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{title}</p>
      ) : null}
      {description ? (
        <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button type="button" onClick={onAction}>{actionLabel}</Button>
      ) : null}
    </div>
  )
}
