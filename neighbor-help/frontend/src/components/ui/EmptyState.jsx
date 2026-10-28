import Button from './Button'

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  emoji = '📝',
  illustration = null,
}) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }} aria-hidden>
        {illustration || (emoji ? <span style={{ fontSize: 52 }}>{emoji}</span> : null)}
      </div>
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
