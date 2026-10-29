/** 轻量骨架：暖色低对比呼吸，贴近页面底色 */
export default function Skeleton({ height = 16, width = '100%', className = '', style }) {
  return (
    <div
      className={`nh-skeleton ${className}`.trim()}
      aria-hidden
      style={{
        height,
        width,
        borderRadius: 12,
        ...style,
      }}
    />
  )
}
