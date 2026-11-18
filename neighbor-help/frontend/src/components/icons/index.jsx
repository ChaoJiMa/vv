import Svg from './svg'
import MenuSticker from './MenuSticker'
import CategoryIcon from './CategoryIcon'

export { MenuSticker }

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** 求助使用援手符号；太阳仅保留给浅色主题，避免业务和外观设置混淆。 */
export function HelpIcon(props) {
  return <CategoryIcon type="help" {...props} />
}

/** 纸箱线稿 */
export function IdleIcon(props) {
  return <CategoryIcon type="idle" {...props} />
}

/** 钥匙线稿 */
export function LostIcon(props) {
  return <CategoryIcon type="lost" {...props} />
}

/** 邻居同行的双人线标 */
export function GroupIcon(props) {
  return <CategoryIcon type="group" {...props} />
}

/** 导航选中使用实心轮廓与真实镂空；颜色跟随父级，不修改通用 Svg 和其他业务线标。 */
export function NavHomeIcon({ filled, ...props }) {
  if (filled) {
    return (
      <Svg {...props} data-active>
        <path
          d="M11.05 2.8a1.5 1.5 0 0 1 1.9 0l8.5 7a1.2 1.2 0 0 1-.76 2.12H20V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8.08h-.69a1.2 1.2 0 0 1-.76-2.12l8.5-7ZM10 22v-6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6h-4Z"
          fill="currentColor" stroke="none" fillRule="evenodd" clipRule="evenodd"
        />
      </Svg>
    )
  }
  return (
    <Svg {...props} data-active={filled || undefined}>
      <path d="m3.5 10 8.5-7 8.5 7M5.5 9v10.5h13V9M9.5 19.5v-6h5v6" {...stroke} />
    </Svg>
  )
}

export function NavDiscoverIcon({ filled, ...props }) {
  if (filled) {
    return (
      <Svg {...props} data-active>
        <path
          d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20ZM16.8 7.2l-3.1 6.5-6.5 3.1 3.1-6.5 6.5-3.1Z"
          fill="currentColor" stroke="none" fillRule="evenodd" clipRule="evenodd"
        />
      </Svg>
    )
  }
  return (
    <Svg {...props} data-active={filled || undefined}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" {...stroke} />
    </Svg>
  )
}

export function NavMessageIcon({ filled, ...props }) {
  if (filled) {
    return (
      <Svg {...props} data-active>
        <path
          d="M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-7.5l-5.3 3.1a.8.8 0 0 1-1.2-.69V19a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM7.75 9.5a1.25 1.25 0 0 0 0 2.5h1.5a1.25 1.25 0 0 0 0-2.5h-1.5ZM14.75 9.5a1.25 1.25 0 0 0 0 2.5h1.5a1.25 1.25 0 0 0 0-2.5h-1.5Z"
          fill="currentColor" stroke="none" fillRule="evenodd" clipRule="evenodd"
        />
      </Svg>
    )
  }
  return (
    <Svg {...props} data-active={filled || undefined}>
      <path
        d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z"
        {...stroke}
        fill="none"
      />
    </Svg>
  )
}

export function NavMeIcon({ filled, ...props }) {
  if (filled) {
    return (
      <Svg {...props} data-active>
        <circle cx="12" cy="6.25" r="4.25" fill="currentColor" stroke="none" />
        <path
          d="M2 21.5c0-5.6 4.5-9 10-9s10 3.4 10 9a.5.5 0 0 1-.5.5h-19a.5.5 0 0 1-.5-.5Z"
          fill="currentColor" stroke="none"
        />
      </Svg>
    )
  }
  // 显式 filled=false 是导航线稿，轮廓约 20px；未传状态的登录页等复用保留原有尺寸。
  return (
    <Svg {...props} data-active={filled || undefined}>
      <circle cx="12" cy={filled === false ? 7 : 8.5} r={filled === false ? 3.75 : 3.25} {...stroke} />
      <path d={filled === false ? 'M3 21c1.5-4 4.5-6 9-6s7.5 2 9 6' : 'M5 19.5c1.2-3.2 3.6-5 7-5s5.8 1.8 7 5'} {...stroke} />
    </Svg>
  )
}

/** 导航显式状态使用约 20px 加号，选中加重；默认形态留给登录等复用，filled 不透传到 SVG。 */
export function NavAddIcon({ filled, ...props }) {
  return (
    <Svg {...props} data-active={filled || undefined}>
      <path
        d={filled === undefined ? 'M12 6v12M6 12h12' : 'M12 3.5v17M3.5 12h17'}
        {...stroke}
        strokeWidth={filled ? 2.8 : stroke.strokeWidth}
      />
    </Svg>
  )
}

export function BackIcon(props) {
  return (
    <Svg {...props}>
      <path d="M15 5.5 8 12l7 6.5" {...stroke} />
    </Svg>
  )
}

export function CloseIcon(props) {
  return (
    <Svg {...props}>
      <path d="m7 7 10 10M17 7 7 17" {...stroke} />
    </Svg>
  )
}

export function MoreIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** 浅色主题 */
export function ThemeSunIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.6" {...stroke} />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M5.8 18.2l1.6-1.6M16.6 7.4l1.6-1.6" {...stroke} />
    </Svg>
  )
}

/** 深色主题 */
export function ThemeMoonIcon(props) {
  return (
    <Svg {...props}>
      <path d="M16.2 4.2A8.2 8.2 0 1 0 19.8 14a6.4 6.4 0 0 1-3.6-9.8Z" {...stroke} />
    </Svg>
  )
}

/** 跟随系统 */
export function ThemeSystemIcon(props) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="11.5" rx="1.8" {...stroke} />
      <path d="M9 19.5h6M12 16.5v3" {...stroke} />
    </Svg>
  )
}

export function SearchIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
      <path d="m15.5 15.5 4 4" {...stroke} />
    </Svg>
  )
}

/** “全部”分类的四格线标，不再使用大色块中的“全”字。 */
export function GridIcon(props) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1.2" {...stroke} />
      <rect x="14" y="4" width="6" height="6" rx="1.2" {...stroke} />
      <rect x="4" y="14" width="6" height="6" rx="1.2" {...stroke} />
      <rect x="14" y="14" width="6" height="6" rx="1.2" {...stroke} />
    </Svg>
  )
}

/** 说明与新手提示独立于“求助互助”分类。 */
export function InfoIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M12 11.5v5" {...stroke} />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** 通知铃铛，供空通知与同类入口复用。 */
export function BellIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 8.5a6 6 0 0 1 12 0v4l1.5 3h-15l1.5-3v-4ZM10 19a2 2 0 0 0 4 0" {...stroke} />
    </Svg>
  )
}

/** 公告使用扩音器，不借用通知或求助符号。 */
export function MegaphoneIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 9h4l9-4v14l-9-4H4V9ZM8 15l1.5 5h3L11 16.3M20 9.5a5 5 0 0 1 0 5" {...stroke} />
    </Svg>
  )
}

export function RefreshIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.9" {...stroke} />
      <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9" {...stroke} />
      <path d="M17 3.8v4.2h-4.2M7 20.2v-4.2h4.2" {...stroke} />
    </Svg>
  )
}

export function SendIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5 12h11" {...stroke} />
      <path d="m12 6.5 6.5 5.5L12 17.5" {...stroke} />
    </Svg>
  )
}

export function CopyIcon(props) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" {...stroke} />
      <path d="M5.5 15.5V6.5A2 2 0 0 1 7.5 4.5h9" {...stroke} />
    </Svg>
  )
}

export function FlagIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 4.5v15" {...stroke} />
      <path d="M6 5.5h10.5l-2 3.5 2 3.5H6" {...stroke} />
    </Svg>
  )
}

export function ChevronIcon(props) {
  return (
    <Svg {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" {...stroke} />
    </Svg>
  )
}

export function ImageIcon(props) {
  return (
    <Svg {...props}>
      <rect x="4" y="5.5" width="16" height="13" rx="2" {...stroke} />
      <circle cx="9" cy="10" r="1.5" {...stroke} />
      <path d="m7.5 16.5 3.2-3.5 2.3 2.3 2.5-3 3 4.2" {...stroke} />
    </Svg>
  )
}

export function NotiCommentIcon(props) {
  return <NavMessageIcon {...props} />
}

export function NotiRespondIcon(props) {
  return (
    <Svg {...props}>
      <path d="M7 12h10" {...stroke} />
      <path d="m13 7.5 4.5 4.5L13 16.5" {...stroke} />
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function NotiAdoptIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" {...stroke} />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" {...stroke} />
    </Svg>
  )
}

export function NotiThankIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 19s-6.5-3.8-6.5-8.2A3.3 3.3 0 0 1 12 8a3.3 3.3 0 0 1 6.5 2.8C18.5 15.2 12 19 12 19Z" {...stroke} />
    </Svg>
  )
}

export function HeartIcon({ filled, ...props }) {
  return (
    <Svg {...props}>
      <path
        d="M12 19s-6.5-3.8-6.5-8.2A3.3 3.3 0 0 1 12 8a3.3 3.3 0 0 1 6.5 2.8C18.5 15.2 12 19 12 19Z"
        {...stroke}
        fill={filled ? 'currentColor' : 'none'}
      />
    </Svg>
  )
}

export function MenuIcon({ type, ...props }) {
  switch (type) {
    case 'idle': return <IdleIcon {...props} />
    case 'lost': return <LostIcon {...props} />
    case 'group': return <GroupIcon {...props} />
    case 'help':
    default: return <HelpIcon {...props} />
  }
}
