import { useState, useRef } from 'react'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

const WARM_FILL = 'var(--color-bg-accent)'
const WARM_FILL_HOVER = 'var(--color-bg-accent)'

const ENTER_MS = 480
const EXIT_MS = 300
const EASE_ENTER = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_EXIT = 'cubic-bezier(0.4, 0, 0.2, 1)'

// 居中底部抽屉：高度随内容撑开；heightVh 保留兼容但不再固定高度（统一上限 90dvh）。
export default function BottomSheet({ open, onClose, title, children }) {
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragging = useRef(false)
  const startY = useRef(0)
  const curDy = useRef(0)

  const resetDrag = () => {
    setDragY(0)
    curDy.current = 0
    dragging.current = false
    setIsDragging(false)
  }

  const handleClose = () => {
    resetDrag()
    onClose?.()
  }

  const onPointerDown = (e) => {
    dragging.current = true
    setIsDragging(true)
    startY.current = e.clientY
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
    setIsDragging(false)
    if (curDy.current > 80) handleClose()
    else { setDragY(0); curDy.current = 0 }
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={handleClose}
      transitionDuration={{ enter: ENTER_MS, exit: EXIT_MS }}
      slotProps={{
        transition: {
          easing: {
            enter: EASE_ENTER,
            exit: EASE_EXIT,
          },
        },
        backdrop: {
          sx: {
            bgcolor: 'rgba(0,0,0,0.28)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            transition: `opacity ${open ? ENTER_MS : EXIT_MS}ms ${open ? EASE_ENTER : EASE_EXIT} !important`,
          },
        },
        paper: {
          sx: {
            width: '100%', maxWidth: 480, mx: 'auto',
            height: 'auto',
            maxHeight: '90dvh',
            borderRadius: '20px 20px 0 0',
            overflow: 'hidden',
            px: 3, pt: 0,
            pb: 'calc(24px + var(--safe-bottom))',
            display: 'flex', flexDirection: 'column',
            bgcolor: 'var(--color-surface)',
            color: 'var(--color-text)',
            borderTop: '1px solid var(--color-border)',
            boxShadow: '0 -6px 28px rgba(0,0,0,0.12)',
            backgroundImage: 'none',
            ...(dragY > 0 ? { transform: `translateY(${dragY}px) !important` } : {}),
            transition: isDragging
              ? 'none'
              : dragY > 0
                ? `transform 0.28s ${EASE_ENTER}`
                : undefined,
          },
        },
      }}
    >
      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 1, flexShrink: 0, cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
      >
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'var(--color-border)' }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 0.5, pb: 2.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-0.01em' }}>{title}</Typography>
        <IconButton onClick={handleClose} sx={{ width: 28, height: 28, bgcolor: WARM_FILL, color: 'var(--color-text-muted)', '&:hover': { bgcolor: WARM_FILL_HOVER } }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      <Box sx={{
        flex: '0 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        display: 'flex',
        flexDirection: 'column',
      }}
      >
        {children}
      </Box>
    </Drawer>
  )
}
