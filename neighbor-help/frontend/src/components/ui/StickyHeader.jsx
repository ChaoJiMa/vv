/** 页面吸顶栏：由全局 chrome 类对齐顶部柔光和安全区，不依赖 iOS 的 fixed 背景附件。 */
export default function StickyHeader({ children, className = '', style, zIndex = 20 }) {
  return (
    <header
      className={`nh-page-chrome-top ${className}`.trim()}
      style={{
        position: 'sticky',
        top: 0,
        zIndex,
        borderBottom: '1px solid var(--color-border)',
        ...style,
      }}
    >
      {children}
    </header>
  )
}
