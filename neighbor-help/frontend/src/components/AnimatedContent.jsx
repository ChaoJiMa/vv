import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'

// ReactBits 风格 Animated Content:子内容整体「淡入 + 位移(可选缩放)」入场。
// 官方版依赖 GSAP + ScrollTrigger;本项目不引 GSAP,用 React 状态翻转 + CSS transition
// 实现「挂载即播放」的同款入场(登录页元素一次性进场,无需滚动触发)。
// 用 transition 而非 @keyframes:避免多个实例在 sx 内定义同名 keyframes 时全局命名冲突。
export default function AnimatedContent({
  children,
  distance = 100, // 位移距离(px)
  direction = 'vertical', // 'vertical' -> translateY;'horizontal' -> translateX
  reverse = false, // 反向:默认从「正方向」(下方/右方)进入,reverse 则从上方/左方
  duration = 0.8, // 时长(s)
  ease = 'cubic-bezier(0.22, 1, 0.36, 1)', // 与 SplitText 同款缓动,质感统一
  initialOpacity = 0,
  animateOpacity = true,
  scale = 1, // 初始缩放(1 = 不缩放)
  delay = 0, // 起始延迟(ms),用于多元素错峰接力
  start = true, // 门控:为 false 时保持初始态不播放,翻 true 才起步(等字体就绪/首屏画完)
  className,
  sx,
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!start) return
    // 双 rAF:第一帧绘制初始态(位移+透明),第二帧翻转触发 transition,
    // 比 setTimeout 更贴渲染节奏,避免起步卡在不确定的时间点
    let raf2
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [start])

  const axis = direction === 'horizontal' ? 'X' : 'Y'
  const offset = reverse ? -distance : distance
  // 是否有实际位移/缩放:无位移(distance=0 且 scale=1)时走纯淡入,
  // 完全不输出 transform —— 纯 opacity 在任何内核(含微信 X5)都不会弹跳。
  const hasMotion = distance !== 0 || scale !== 1
  // 用 3D translate3d 而非 2D:微信 X5(老 Blink)对 2D transform 动画走 CPU 重绘会子像素抖动,
  // 3D 强制 GPU 独立合成层,不重绘不抖。
  const tx = axis === 'X' ? offset : 0
  const ty = axis === 'Y' ? offset : 0
  const fromTransform = `translate3d(${tx}px, ${ty}px, 0)${scale !== 1 ? ` scale(${scale})` : ''}`

  return (
    <Box
      className={className}
      sx={{
        opacity: animateOpacity ? (shown ? 1 : initialOpacity) : 1,
        ...(hasMotion
          ? {
              transform: shown ? 'translate3d(0, 0, 0)' : fromTransform,
              backfaceVisibility: 'hidden',
              willChange: 'transform, opacity',
              transition: `transform ${duration}s ${ease}, opacity ${duration}s ${ease}`,
            }
          : {
              willChange: 'opacity',
              transition: `opacity ${duration}s ${ease}`,
            }),
        transitionDelay: `${delay}ms`,
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}
