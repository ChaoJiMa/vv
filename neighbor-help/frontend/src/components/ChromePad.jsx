/**
 * 安全区垫层不接管指针，z 低于业务 fixed 层（composer z40 / BottomNav z1200）。
 * 底部默认截取全局柔光；注册作用域跟随表单主题底色，顶部仅在注册时补头图起色。
 */
export default function ChromePad() {
  return (
    <>
      <div
        aria-hidden
        className="nh-page-safe-top"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          width: '100%', maxWidth: 480, margin: '0 auto',
          // 注册表单面板自身为 z1，顶垫层需更高一级，滚动到顶时仍保留暖黄色安全区。
          height: 'var(--safe-top)', zIndex: 2, pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        className="nh-page-chrome-bottom"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
          height: 'var(--safe-bottom)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
