export default function Skeleton({ height = 16, width = '100%', className = '', style }) {
  return (
    <div
      className={className}
      aria-hidden
      style={{
        height,
        width,
        borderRadius: 12,
        background: 'var(--color-bg-accent)',
        opacity: 0.85,
        ...style,
      }}
    />
  )
}
