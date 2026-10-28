export default function IconBtn({
  children,
  onClick,
  ariaLabel,
  style,
  disabled = false,
  ...rest
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        border: 'none',
        borderRadius: 22,
        background: 'transparent',
        color: 'var(--color-text)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
