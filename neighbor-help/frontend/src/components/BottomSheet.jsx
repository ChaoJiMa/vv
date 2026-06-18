import { useState, useRef } from 'react'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

const WARM_FILL = '#F4EEE7'
const WARM_FILL_HOVER = '#EDE4DA'

// 居中底部抽屉:从底部滑入,圆角顶 + 拖拽手柄 + 标题 + 圆形关闭按钮。
// 手柄区支持指针拖拽:按住下滑跟手移动,松手超过阈值关闭,否则回弹。
// 全站统一弹窗样式(登录页、个人页共用)。
export default function BottomSheet({ open, onClose, title, heightVh = 50, children }) {
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false) // 仅用于渲染期决定是否禁用过渡
  const dragging = useRef(false)
  const startY = useRef(0)
  const curDy = useRef(0)

  const onPointerDown = (e) => {
    dragging.current = true
    setIsDragging(true)
    startY.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragging.current) return
    const dy = Math.max(0, e.clientY - startY.current) // 只允许向下
    curDy.current = dy
    setDragY(dy)
  }
  const endDrag = () => {
    if (!dragging.current) return
    dragging.current = false
    setIsDragging(false)
    // 下滑超过 80px 视为关闭意图,否则回弹
    if (curDy.current > 80) onClose()
    else { setDragY(0); curDy.current = 0 }
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      // 进入用 ease-out-expo:起步快、长程平滑减速到停,无过冲回弹(最顺滑、不突兀);退出干脆
      transitionDuration={{ enter: 450, exit: 240 }}
      slotProps={{
        transition: {
          easing: {
            enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
            exit: 'cubic-bezier(0.4, 0, 1, 1)',
          },
        },
        backdrop: {
          // 遮罩降低黑度 + 轻微模糊,避免瞬间压黑的生硬感
          sx: {
            bgcolor: 'rgba(0,0,0,0.32)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          },
        },
        paper: {
          sx: {
            width: '100%', maxWidth: 480, mx: 'auto',
            height: `${heightVh}dvh`,
            borderRadius: '20px 20px 0 0',
            overflow: 'hidden',
            px: 3, pt: 0,
            // 底部内边距并入 iOS 安全区,避免按钮被 Home 指示条遮挡
            pb: 'calc(24px + env(safe-area-inset-bottom))',
            display: 'flex', flexDirection: 'column',
            bgcolor: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            borderTop: '1px solid rgba(255,255,255,0.5)',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
            backgroundImage: 'none',
            transform: dragY ? `translateY(${dragY}px)` : 'none',
            transition: isDragging ? 'none' : 'transform 0.25s ease',
          },
        },
      }}
    >
      {/* 拖拽手柄(可按住下滑关闭) */}
      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 1, flexShrink: 0, cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
      >
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'rgba(31,38,48,0.3)' }} />
      </Box>
      {/* 标题行 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 0.5, pb: 2.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 600, color: '#1C1C1E', letterSpacing: '-0.01em' }}>{title}</Typography>
        <IconButton onClick={onClose} sx={{ width: 28, height: 28, bgcolor: WARM_FILL, color: '#8E8E93', '&:hover': { bgcolor: WARM_FILL_HOVER } }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      {/* 内容区:可滚动 */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Drawer>
  )
}
