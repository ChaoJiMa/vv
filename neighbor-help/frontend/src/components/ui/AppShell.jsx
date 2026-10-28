export default function AppShell({ children, withNav = false, className = '', style }) {
  return (
    <div
      className={className}
      style={{
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        minHeight: '100svh',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        boxSizing: 'border-box',
        paddingBottom: withNav ? 'var(--nav-height)' : undefined,
        textAlign: 'left',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
