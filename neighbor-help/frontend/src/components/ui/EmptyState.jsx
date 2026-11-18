import Button from './Button'

/** 统一空状态：可选 actionLoading 锁定等待中的恢复入口，装饰符号仍按需展示。 */
export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionLoading = false,
  emoji = null,
  illustration = null,
}) {
  const artwork = illustration || (emoji ? <span style={{ fontSize: 40, lineHeight: 1.4 }}>{emoji}</span> : null)
  const hasAction = !!(actionLabel && onAction)
  return (
    <div style={{ textAlign: 'center', padding: '40px 24px' }}>
      {artwork ? (
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }} aria-hidden>
          {artwork}
        </div>
      ) : null}
      {title ? (
        <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{title}</p>
      ) : null}
      {description ? (
        <p style={{ margin: hasAction ? '0 0 20px' : 0, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{description}</p>
      ) : null}
      {hasAction ? (
        <Button type="button" onClick={onAction} loading={actionLoading} aria-busy={actionLoading || undefined}>{actionLabel}</Button>
      ) : null}
    </div>
  )
}
