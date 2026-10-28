function Frame({ children, size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      {children}
    </svg>
  )
}

const soft = 'var(--color-bg-accent)'
const line = 'var(--color-primary)'
const mute = 'var(--color-text-muted)'

export function EmptyPosts({ size }) {
  return (
    <Frame size={size}>
      <rect x="22" y="28" width="76" height="64" rx="14" fill={soft} />
      <rect x="34" y="42" width="36" height="6" rx="3" fill={line} opacity="0.85" />
      <rect x="34" y="54" width="52" height="5" rx="2.5" fill={mute} opacity="0.35" />
      <rect x="34" y="64" width="44" height="5" rx="2.5" fill={mute} opacity="0.25" />
      <circle cx="86" cy="78" r="14" fill={line} opacity="0.2" />
      <path d="M86 72v12M80 78h12" stroke={line} strokeWidth="2" strokeLinecap="round" />
    </Frame>
  )
}

export function EmptySearch({ size }) {
  return (
    <Frame size={size}>
      <circle cx="52" cy="52" r="22" stroke={line} strokeWidth="2.5" fill={soft} />
      <path d="m68 68 18 18" stroke={line} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M44 52h16M52 44v16" stroke={mute} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
    </Frame>
  )
}

export function EmptyMessages({ size }) {
  return (
    <Frame size={size}>
      <rect x="20" y="34" width="52" height="36" rx="12" fill={soft} stroke={line} strokeWidth="1.75" />
      <path d="M28 70 22 82l16-8" fill={soft} stroke={line} strokeWidth="1.75" strokeLinejoin="round" />
      <rect x="48" y="48" width="48" height="32" rx="12" fill={line} opacity="0.18" stroke={line} strokeWidth="1.75" />
      <circle cx="36" cy="50" r="2" fill={mute} />
      <circle cx="46" cy="50" r="2" fill={mute} />
      <circle cx="56" cy="50" r="2" fill={mute} />
    </Frame>
  )
}

export function EmptyNotices({ size }) {
  return (
    <Frame size={size}>
      <path d="M40 70c0-12 8-22 20-22s20 10 20 22" stroke={line} strokeWidth="2" fill={soft} />
      <path d="M48 70h24" stroke={line} strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="36" r="6" fill={line} opacity="0.35" stroke={line} strokeWidth="1.5" />
      <rect x="56" y="74" width="8" height="10" rx="2" fill={mute} opacity="0.4" />
    </Frame>
  )
}

export function EmptyLost({ size }) {
  return (
    <Frame size={size}>
      <circle cx="52" cy="50" r="20" fill={soft} stroke={line} strokeWidth="2" />
      <path d="m66 66 16 16" stroke={line} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M44 50h16" stroke={mute} strokeWidth="2" strokeLinecap="round" />
      <text x="60" y="108" textAnchor="middle" fill={mute} fontSize="11" fontFamily="system-ui">404</text>
    </Frame>
  )
}
