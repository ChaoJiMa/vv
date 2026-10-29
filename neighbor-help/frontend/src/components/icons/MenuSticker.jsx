/**
 * 四类服务拟人贴纸（固定色面，不跟 currentColor）。
 * 仅用于首页入口 / 发帖大选择等 ≥32px 场景。
 */
const PALETTE = {
  help: {
    bg: '#FFE49A',
    ink: '#C56A12',
    accent: '#FFB020',
    face: '#FFF8E7',
  },
  idle: {
    bg: '#F3E0C0',
    ink: '#8B6914',
    accent: '#D4A574',
    face: '#FFF6E8',
  },
  lost: {
    bg: '#C6ECDC',
    ink: '#1F7A62',
    accent: '#3D9B84',
    face: '#F0FFF8',
  },
  group: {
    bg: '#C8E6F8',
    ink: '#2A6F96',
    accent: '#5BA8D0',
    face: '#F2FAFF',
  },
}

function Shell({ size, className, style, bg, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden
      {...rest}
    >
      <rect x="2" y="2" width="60" height="60" rx="18" fill={bg} />
      {children}
    </svg>
  )
}

/** 小太阳邻居：圆脸太阳 + 小手臂帮忙 */
function HelpArt({ p }) {
  return (
    <>
      {/* rays */}
      <path d="M32 10v5M32 49v5M10 32h5M49 32h5M15.5 15.5l3.5 3.5M45 45l3.5 3.5M15.5 48.5l3.5-3.5M45 19l3.5-3.5" stroke={p.accent} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="30" r="13" fill={p.face} stroke={p.ink} strokeWidth="2" />
      <circle cx="27.5" cy="28" r="1.6" fill={p.ink} />
      <circle cx="36.5" cy="28" r="1.6" fill={p.ink} />
      <path d="M27 34.5c1.6 2.2 4.4 2.2 6 0" stroke={p.ink} strokeWidth="1.8" strokeLinecap="round" />
      {/* arms */}
      <path d="M19 36c-3 2-4 6-2.5 8" stroke={p.ink} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M45 36c3 2 4 6 2.5 8" stroke={p.ink} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16.5" cy="45" r="2.2" fill={p.accent} stroke={p.ink} strokeWidth="1.4" />
      <circle cx="47.5" cy="45" r="2.2" fill={p.accent} stroke={p.ink} strokeWidth="1.4" />
    </>
  )
}

/** 纸箱小人：开盖纸箱 + 眼睛 + 小手 */
function IdleArt({ p }) {
  return (
    <>
      {/* flaps */}
      <path d="M18 22 L26 16 L32 22" fill={p.accent} stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M46 22 L38 16 L32 22" fill={p.accent} stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" />
      {/* body */}
      <rect x="18" y="22" width="28" height="26" rx="4" fill={p.face} stroke={p.ink} strokeWidth="2" />
      <path d="M32 22v26" stroke={p.ink} strokeWidth="1.6" opacity="0.45" />
      <circle cx="26" cy="34" r="1.8" fill={p.ink} />
      <circle cx="38" cy="34" r="1.8" fill={p.ink} />
      <path d="M28 40c1.4 1.6 4.6 1.6 6 0" stroke={p.ink} strokeWidth="1.6" strokeLinecap="round" />
      {/* hands */}
      <circle cx="15" cy="38" r="3" fill={p.accent} stroke={p.ink} strokeWidth="1.5" />
      <circle cx="49" cy="38" r="3" fill={p.accent} stroke={p.ink} strokeWidth="1.5" />
    </>
  )
}

/** 钥匙精灵：钥匙身 + 小翅膀 + 圆脸 */
function LostArt({ p }) {
  return (
    <>
      {/* wings */}
      <path d="M22 26c-6-2-9 2-8 7 3-1 6 0 8-2" fill={p.face} stroke={p.ink} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M42 26c6-2 9 2 8 7-3-1-6 0-8-2" fill={p.face} stroke={p.ink} strokeWidth="1.6" strokeLinejoin="round" />
      {/* key head */}
      <circle cx="32" cy="26" r="10" fill={p.accent} stroke={p.ink} strokeWidth="2" />
      <circle cx="32" cy="26" r="4.5" fill={p.face} stroke={p.ink} strokeWidth="1.6" />
      <circle cx="28.5" cy="24.5" r="1.4" fill={p.ink} />
      <circle cx="35.5" cy="24.5" r="1.4" fill={p.ink} />
      <path d="M29.5 29c1 1.4 3 1.4 4 0" stroke={p.ink} strokeWidth="1.4" strokeLinecap="round" />
      {/* shaft + teeth */}
      <rect x="29.5" y="36" width="5" height="14" rx="1.5" fill={p.accent} stroke={p.ink} strokeWidth="1.6" />
      <path d="M34.5 44h5M34.5 48h4" stroke={p.ink} strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

/** 购物袋小人：竖袋 + 提手耳朵 + 笑脸 */
function GroupArt({ p }) {
  return (
    <>
      {/* handles */}
      <path d="M24 22c0-7 16-7 16 0" stroke={p.ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* bag */}
      <path d="M18 24h28l-2 28H20L18 24Z" fill={p.accent} stroke={p.ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M22 24c2 6 18 6 20 0" stroke={p.ink} strokeWidth="1.5" opacity="0.35" />
      <circle cx="27" cy="36" r="1.7" fill={p.face} />
      <circle cx="37" cy="36" r="1.7" fill={p.face} />
      <circle cx="27" cy="36" r="1" fill={p.ink} />
      <circle cx="37" cy="36" r="1" fill={p.ink} />
      <path d="M28 42c2 2.2 6 2.2 8 0" stroke={p.face} strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

const ARTS = {
  help: HelpArt,
  idle: IdleArt,
  lost: LostArt,
  group: GroupArt,
}

export default function MenuSticker({ type = 'help', size = 48, className = '', style, ...rest }) {
  const key = ARTS[type] ? type : 'help'
  const p = PALETTE[key]
  const Art = ARTS[key]
  return (
    <Shell size={size} className={className} style={style} bg={p.bg} {...rest}>
      <Art p={p} />
    </Shell>
  )
}
