import { useId, useState, useRef } from 'react'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

const ENTER_MS = 480
const EXIT_MS = 300
const EASE_ENTER = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_EXIT = 'cubic-bezier(0.4, 0, 0.2, 1)'

// 居中底部抽屉：高度随内容撑开；heightVh 保留兼容但不再固定高度（统一上限 90dvh）。
export default function BottomSheet({ open, onClose, title, children, className }) {
  // 标题为 Portal 内的对话框提供可访问名称，账号登录抽屉也能直接被读屏识别。
  const titleId = useId()
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
      className={className}
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
          'aria-labelledby': title ? titleId : undefined,
          sx: {
            width: '100%', maxWidth: 480, mx: 'auto',
            height: 'auto',
            maxHeight: '90dvh',
            borderRadius: '20px 20px 0 0',
            overflow: 'hidden',
            px: 3, pt: 0,
            pb: 'calc(24px + var(--safe-bottom))',
            display: 'flex', flexDirection: 'column',
            // 面板在视口底部取同一柔光场景，保留实底；不在抽屉顶部重新起一组渐变。
            bgcolor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderTop: '1px solid var(--color-border)',
            boxShadow: '0 -6px 28px rgba(0,0,0,0.12)',
            backgroundImage: 'var(--page-glow)',
            backgroundSize: '100% 100svh',
            backgroundPosition: 'center bottom',
            backgroundRepeat: 'no-repeat',
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
        {/* 拖拽提示与关闭图标共用主色，浅色黑、深色白。 */}
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'var(--color-primary)' }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 0.5, pb: 2.5, flexShrink: 0 }}>
        <Typography id={titleId} component="h2" sx={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-0.01em' }}>{title}</Typography>
        <IconButton disableRipple aria-label="关闭" onClick={handleClose} sx={{ width: 44, height: 44, bgcolor: 'transparent', color: 'var(--color-primary)', '&:hover': { bgcolor: 'transparent', color: 'var(--color-primary)' }, '&.Mui-focusVisible': { outline: '2px solid var(--color-primary)', outlineOffset: 2 } }}>
          <CloseIcon sx={{ fontSize: 20 }} />
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
