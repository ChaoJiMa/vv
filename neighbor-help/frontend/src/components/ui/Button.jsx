export default function Button({
  variant = 'primary',
  loading = false,
  disabled = false,
  type = 'button',
  children,
  style,
  className = '',
  ...rest
}) {
  const isPrimary = variant === 'primary'
  const isGhost = variant === 'ghost'
  const busy = loading || disabled

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    padding: '10px 18px',
    borderRadius: 'var(--radius-btn)',
    border: isPrimary || isGhost ? 'none' : '1.5px solid var(--color-border)',
    fontSize: 15,
    fontWeight: 600,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.65 : 1,
    transition: `transform var(--motion-duration) ease, background var(--motion-duration) ease`,
    background: isPrimary
      ? 'var(--color-primary)'
      : isGhost
        ? 'transparent'
        : 'var(--color-surface)',
    color: isPrimary ? 'var(--color-on-primary)' : 'var(--color-text)',
    boxShadow: isPrimary ? 'var(--shadow-card)' : 'none',
    ...style,
  }

  return (
    <button
      type={type}
      className={className}
      disabled={busy}
      style={base}
      onMouseDown={(e) => {
        if (!busy) e.currentTarget.style.transform = 'scale(0.96)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = ''
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
      }}
      {...rest}
    >
      {loading ? '…' : children}
    </button>
  )
}
