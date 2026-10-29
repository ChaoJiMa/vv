/**
 * 仅垫 Home 指示条高度，z 低于业务 fixed 层（composer z40 / BottomNav z1200），
 * 避免盖住详情评论条；全宽实色供 Safari 底栏采样。
 */
export default function ChromePad() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 'var(--safe-bottom)',
        background: 'var(--chrome-color, var(--color-bg))',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    />
  )
}
