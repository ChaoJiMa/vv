/** 页面吸顶栏：含 iOS 安全区，背景毛玻璃 */
export default function StickyHeader({ children, className = '', style, zIndex = 20 }) {
  return (
    <header
      className={className}
      style={{
        position: 'sticky',
        top: 0,
        zIndex,
        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--color-border)',
        ...style,
      }}
    >
      {children}
    </header>
  )
}
