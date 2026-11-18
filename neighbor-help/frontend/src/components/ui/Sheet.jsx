import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ENTER_MS = 420
const EXIT_MS = 280
const EASE_ENTER = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_EXIT = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** 底部抽屉：高度随内容撑开；portal 到 body，避免底栏 backdrop-filter 裁切 fixed */
export default function Sheet({ open, onClose, title, children }) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [openSnap, setOpenSnap] = useState(open)
  const [dragY, setDragY] = useState(0)
  const [suppressTransition, setSuppressTransition] = useState(false)
  const dragging = useRef(false)
  const startY = useRef(0)
  const curDy = useRef(0)

  if (open !== openSnap) {
    setOpenSnap(open)
    if (open) {
      setMounted(true)
      setDragY(0)
    } else {
      setVisible(false)
    }
  }

  useEffect(() => {
    if (!open || !mounted) return undefined
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true))
    })
    return () => cancelAnimationFrame(id)
  }, [open, mounted])

  useEffect(() => {
    if (open || !mounted) return undefined
    const t = setTimeout(() => {
      setMounted(false)
      setDragY(0)
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [open, mounted])

  useEffect(() => {
    if (!mounted) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mounted])

  const onPointerDown = (e) => {
    // 关闭等头部控件需要保留自己的点击目标；父级捕获指针会把鼠标 click 重定向到拖拽区。
    // 使用 closest 同时覆盖图标等控件子元素，只有非交互标题或拖拽条才开始拖动。
    const control = e.target.closest?.('button, a, input, select, textarea, [role="button"]')
    if (control && e.currentTarget.contains(control)) return
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

  const panelEase = visible ? EASE_ENTER : EASE_EXIT
  const panelMs = visible ? ENTER_MS : EXIT_MS

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="presentation"
      onClick={() => { setDragY(0); onClose?.() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        background: visible ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(3px)' : 'blur(0px)',
        WebkitBackdropFilter: visible ? 'blur(3px)' : 'blur(0px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        transition: `background ${panelMs}ms ${panelEase}, backdrop-filter ${panelMs}ms ${panelEase}`,
      }}
    >
      <div
        role="dialog"
        className="nh-page-chrome-bottom"
        aria-modal
        aria-label={title || '面板'}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          height: 'auto',
          maxHeight: '90dvh',
          borderRadius: '20px 20px 0 0',
          // 实底由主题提供，柔光按视口底部对齐；输入框/卡片继续使用独立 surface。
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          boxShadow: '0 -6px 28px rgba(0,0,0,0.12)',
          borderTop: '1px solid var(--color-border)',
          padding: '0 20px calc(24px + var(--safe-bottom))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: suppressTransition ? 'none' : `transform ${panelMs}ms ${panelEase}`,
          willChange: 'transform',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ paddingTop: 10, paddingBottom: 8, cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
        >
          {/* 与主按钮同色，保证两种主题下都清晰可见。 */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-primary)', margin: '0 auto 12px' }} />
          {title ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => { setDragY(0); onClose?.() }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-primary)',
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
        <div
          style={{
            flex: '0 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
          className="nh-sheet-body"
        >
          {children}
        </div>
        <style>{`.nh-sheet-body::-webkit-scrollbar{display:none}`}</style>
      </div>
    </div>,
    document.body,
  )
}
