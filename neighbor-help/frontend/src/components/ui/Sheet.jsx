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
        aria-modal
        aria-label={title || '面板'}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          height: 'auto',
          maxHeight: '90dvh',
          borderRadius: '20px 20px 0 0',
          background: 'var(--color-surface)',
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
