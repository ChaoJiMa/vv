import Svg from './svg'

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function HelpIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1.9-1.1 1.75" {...stroke} />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IdleIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 9.5 12 4l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5Z" {...stroke} />
      <path d="M9 21V12h6v9" {...stroke} />
    </Svg>
  )
}

export function LostIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path d="m16 16 4 4" {...stroke} />
      <path d="M9 11h4M11 9v4" {...stroke} />
    </Svg>
  )
}

export function GroupIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="9" r="3" {...stroke} />
      <circle cx="16.5" cy="10" r="2.5" {...stroke} />
      <path d="M3.5 19c.6-2.8 2.7-4.5 5.5-4.5s4.9 1.7 5.5 4.5" {...stroke} />
      <path d="M13.2 14.6c.9-.7 2-1.1 3.3-1.1 2.2 0 3.9 1.2 4.5 3.5" {...stroke} />
    </Svg>
  )
}

export function NavHomeIcon({ filled, ...props }) {
  return (
    <Svg {...props}>
      {filled ? (
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.5v-6h-3v6H5a1 1 0 0 1-1-1v-9.5Z" fill="currentColor" stroke="none" />
      ) : (
        <>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9.5Z" {...stroke} />
          <path d="M9.5 21v-7h5v7" {...stroke} />
        </>
      )}
    </Svg>
  )
}

export function NavDiscoverIcon({ filled, ...props }) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path d="m16.2 16.2 3.3 3.3" {...stroke} />
      {filled ? <circle cx="11" cy="11" r="2.2" fill="currentColor" stroke="none" /> : null}
    </Svg>
  )
}

export function NavMessageIcon({ filled, ...props }) {
  return (
    <Svg {...props}>
      <path
        d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z"
        {...stroke}
        fill={filled ? 'currentColor' : 'none'}
      />
    </Svg>
  )
}

export function NavMeIcon({ filled, ...props }) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.25" {...stroke} fill={filled ? 'currentColor' : 'none'} />
      <path d="M5 19.5c1.2-3.2 3.6-5 7-5s5.8 1.8 7 5" {...stroke} />
    </Svg>
  )
}

export function NavAddIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 6.5v11M6.5 12h11" {...stroke} strokeWidth={2} />
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

export function SearchIcon(props) {
  return <NavDiscoverIcon {...props} />
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

export function MenuIcon({ type, ...props }) {
  switch (type) {
    case 'idle': return <IdleIcon {...props} />
    case 'lost': return <LostIcon {...props} />
    case 'group': return <GroupIcon {...props} />
    case 'help':
    default: return <HelpIcon {...props} />
  }
}
