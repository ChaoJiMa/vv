import Box from '@mui/material/Box'

// ReactBits 风格 Split Text:把文字按字符拆开,逐字从下方错峰淡入。
// reactbits 官方版依赖 GSAP;本项目不引 GSAP,用纯 CSS keyframes + 递增 animation-delay 实现同款入场。
// 可访问性:外层 span 带 aria-label 提供完整文本,逐字 span 设 aria-hidden,避免读屏逐字念。
export default function SplitText({
  text = '',
  delay = 80, // 每字之间的错峰间隔(ms)
  duration = 0.6, // 单字动画时长(s)
  startDelay = 0, // 整体起始延迟(ms),用于多段文字接力入场
  start = true, // 门控:为 false 时保持隐藏不播放,翻 true 才起步(等字体就绪/首屏画完)
  className,
  sx,
}) {
  const chars = Array.from(text)
  return (
    <Box
      component="span"
      className={className}
      aria-label={text}
      sx={{
        display: 'inline-block',
        // 显式 lineHeight:行盒高 = fontSize × lineHeight,与字体 family 无关。
        // 不设的话 line-height:normal 随字体变,自托管字体加载完成的瞬间会改变标题占位高度,
        // 在贴底布局下把整组顶上/下移 —— 表现为「icon 弹跳」。可被传入 sx 覆盖。
        lineHeight: 1.3,
        '@keyframes splitTextIn': {
          '0%': { opacity: 0, transform: 'translate3d(0, 28px, 0)' },
          '100%': { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        },
        ...sx,
      }}
    >
      {chars.map((ch, i) => (
        <Box
          key={i}
          component="span"
          aria-hidden="true"
          sx={{
            display: 'inline-block',
            whiteSpace: 'pre', // 保留空格,空格也作为一个 char 占位
            willChange: 'transform, opacity',
            backfaceVisibility: 'hidden',
            // 逐字 translate3d 上浮入场(GPU 合成层)。start=false 时静态停在动画 0% 起始态
            // (下方 28px + 透明),与 both 动画 0% 一致 —— 揭示瞬间起点不跳变。
            opacity: start ? undefined : 0,
            transform: start ? undefined : 'translate3d(0, 28px, 0)',
            animation: start ? `splitTextIn ${duration}s cubic-bezier(0.22, 1, 0.36, 1) both` : 'none',
            animationDelay: `${startDelay + i * delay}ms`,
          }}
        >
          {ch}
        </Box>
      ))}
    </Box>
  )
}
