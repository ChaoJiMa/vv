export default function AppShell({ children, withNav = false, className = '', style }) {
  return (
    <div
      className={className}
      style={{
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        minHeight: '100svh',
        // 全页底色和柔光由 body 的单层画布提供，外壳不再重复覆盖或绘制。
        background: 'transparent',
        color: 'var(--color-text)',
        boxSizing: 'border-box',
        // 悬浮底栏的整块占位包含胶囊和下方留白，保证列表末项可滚到操作区上方。
        paddingBottom: withNav ? 'var(--nav-floating-footprint)' : undefined,
        textAlign: 'left',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
