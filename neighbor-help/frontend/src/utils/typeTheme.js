/** 四类服务封面/ pill 色（列表卡与详情共用） */
export const TYPE_THEME = {
  help: {
    label: '求助互助',
    pillBg: '#FFE49A',
    pillFg: '#C56A12',
    cover: 'linear-gradient(125deg, #FFE49A 0%, #FFB070 55%, #FFD4A8 100%)',
  },
  idle: {
    label: '闲置转让',
    pillBg: '#F3E0C0',
    pillFg: '#8B6914',
    cover: 'linear-gradient(125deg, #FFF6E8 0%, #F3E0C0 50%, #E8D0A8 100%)',
  },
  lost: {
    label: '失物招领',
    pillBg: '#C6ECDC',
    pillFg: '#1F7A62',
    cover: 'linear-gradient(125deg, #E8F8F1 0%, #C6ECDC 50%, #7bc9a6 100%)',
  },
  group: {
    label: '拼单拼团',
    pillBg: '#C8E6F8',
    pillFg: '#2A6F96',
    cover: 'linear-gradient(125deg, #F2FAFF 0%, #C8E6F8 50%, #5BA8D0 100%)',
  },
}

export function getTypeTheme(type, menu) {
  const base = TYPE_THEME[type] || TYPE_THEME.help
  return { ...base, label: menu?.label || base.label }
}

export function formatRelativeTime(ts) {
  if (!ts) return ''
  const d = new Date(typeof ts === 'number' ? ts : Number(ts))
  if (Number.isNaN(d.getTime())) return ''
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function typePillStyle(theme) {
  return {
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    padding: '5px 9px',
    borderRadius: 999,
    background: theme.pillBg,
    color: theme.pillFg,
    boxShadow: '0 1px 2px rgba(0,0,0,.06)',
  }
}

export const timeBadgeStyle = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1,
  padding: '5px 8px',
  borderRadius: 999,
  background: 'rgba(0,0,0,.38)',
  color: '#fff',
}
