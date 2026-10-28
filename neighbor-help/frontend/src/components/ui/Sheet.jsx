import { useEffect, useRef, useState } from 'react'

/** 底部抽屉：遮罩关闭、拖拽下滑关闭，吃设计 token */
export default function Sheet({ open, onClose, title, heightVh = 50, children }) {
  const [dragY, setDragY] = useState(0)
  const [suppressTransition, setSuppressTransition] = useState(false)
  const dragging = useRef(false)
  const startY = useRef(0)
  const curDy = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  const onPointerDown = (e) => {
    dragging.current = true
    setSuppressTransition(true)
    startY.current = e.clientY
    curDy.current = 0
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragging.current) return
    const dy = Math.max(0, e.clientY - startY.current)
    curDy.current = dy
    setDragY(dy)
  }
  const endDrag = () => {
    if (!dragging.current) return
    dragging.current = false
    setSuppressTransition(false)
    if (curDy.current > 80) {
      setDragY(0)
      onClose?.()
    } else {
      setDragY(0)
      curDy.current = 0
    }
  }

  return (
    <div
      role="presentation"
      onClick={() => { setDragY(0); onClose?.() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(0,0,0,0.36)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={title || '面板'}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          height: `${heightVh}dvh`,
          borderRadius: '20px 20px 0 0',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.2)',
          borderTop: '1px solid var(--color-border)',
          padding: '0 20px calc(24px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: suppressTransition ? 'none' : 'transform 200ms ease',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ paddingTop: 10, paddingBottom: 8, cursor: 'grab', touchAction: 'none' }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-border)', margin: '0 auto 12px' }} />
          {title ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => { setDragY(0); onClose?.() }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  border: 'none',
                  background: 'var(--color-bg-accent)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}
