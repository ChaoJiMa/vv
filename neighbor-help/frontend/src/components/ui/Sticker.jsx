const TINTS = {
  mint: 'var(--color-accent-mint)',
  sky: 'var(--color-accent-sky)',
  cream: 'var(--color-accent-cream)',
  primary: 'var(--color-primary)',
}

export default function Sticker({
  active = false,
  color = 'cream',
  children,
  onClick,
  style,
  ...rest
}) {
  const tint = TINTS[color] || TINTS.cream
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        padding: '8px 14px',
        borderRadius: 999,
        border: active ? 'none' : `1.5px solid var(--color-border)`,
        background: active ? 'var(--color-primary)' : tint,
        color: active ? 'var(--color-on-primary)' : 'var(--color-text)',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        transition: `transform var(--motion-duration) ease`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
