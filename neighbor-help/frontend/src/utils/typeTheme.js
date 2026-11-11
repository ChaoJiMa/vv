/**
 * 四类服务的糖果色语义：列表标签、分类卡和详情共用同一组 CSS Token。
 * pillBg 保留纯色供小标签使用；cardBg / cardShadow 仅供功能卡添加短渐变与细高光。
 * 保留原返回字段，颜色由 data-theme 解析，调用方无需监听主题或重新计算样式。
 */
export const TYPE_THEME = {
  help: {
    label: '求助互助',
    pillBg: 'var(--color-category-help-bg)',
    pillFg: 'var(--color-category-help-fg)',
    cardBg: 'linear-gradient(145deg, var(--color-category-help-soft) 0%, var(--color-category-help-bg) 65%)',
    cardShadow: 'inset 0 1px 0 var(--color-material-highlight), var(--shadow-candy)',
    cover: 'linear-gradient(125deg, var(--color-category-help-soft) 0%, var(--color-category-help-bg) 100%)',
  },
  idle: {
    label: '闲置转让',
    pillBg: 'var(--color-category-idle-bg)',
    pillFg: 'var(--color-category-idle-fg)',
    cardBg: 'linear-gradient(145deg, var(--color-category-idle-soft) 0%, var(--color-category-idle-bg) 65%)',
    cardShadow: 'inset 0 1px 0 var(--color-material-highlight), var(--shadow-candy)',
    cover: 'linear-gradient(125deg, var(--color-category-idle-soft) 0%, var(--color-category-idle-bg) 100%)',
  },
  lost: {
    label: '失物招领',
    pillBg: 'var(--color-category-lost-bg)',
    pillFg: 'var(--color-category-lost-fg)',
    cardBg: 'linear-gradient(145deg, var(--color-category-lost-soft) 0%, var(--color-category-lost-bg) 65%)',
    cardShadow: 'inset 0 1px 0 var(--color-material-highlight), var(--shadow-candy)',
    cover: 'linear-gradient(125deg, var(--color-category-lost-soft) 0%, var(--color-category-lost-bg) 100%)',
  },
  group: {
    label: '拼单拼团',
    pillBg: 'var(--color-category-group-bg)',
    pillFg: 'var(--color-category-group-fg)',
    cardBg: 'linear-gradient(145deg, var(--color-category-group-soft) 0%, var(--color-category-group-bg) 65%)',
    cardShadow: 'inset 0 1px 0 var(--color-material-highlight), var(--shadow-candy)',
    cover: 'linear-gradient(125deg, var(--color-category-group-soft) 0%, var(--color-category-group-bg) 100%)',
  },
}

export function getTypeTheme(type, menu) {
  // 未知类型不能从对象原型取到同名成员，否则会丢失默认颜色与分类标签。
  const base = Object.prototype.hasOwnProperty.call(TYPE_THEME, type) ? TYPE_THEME[type] : TYPE_THEME.help
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
