export default function Fab({ onClick, children, ariaLabel = '操作', style, ...rest }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'calc(var(--nav-height) + 12px + env(safe-area-inset-bottom))',
        width: 56,
        height: 56,
        borderRadius: 28,
        border: 'none',
        background: 'var(--color-primary)',
        color: 'var(--color-on-primary)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 40,
        transition: 'transform var(--motion-duration) ease',
        ...style,
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = '' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
      {...rest}
    >
      {children}
    </button>
  )
}
