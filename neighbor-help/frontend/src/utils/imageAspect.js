import { coverKey } from './image'
import { getTypeTheme } from './typeTheme'

/** 列表卡片封面高宽比 h/w 夹在 4:3～3:4 之间 */
export const ASPECT_MIN = 3 / 4 // 横图下限
export const ASPECT_MAX = 4 / 3 // 竖图上限
export const NO_IMAGE_ASPECT = 0.85

/** 详情封面更接近小红书：允许更高竖图 */
export const DETAIL_ASPECT_MIN = 0.75
export const DETAIL_ASPECT_MAX = 1.6

const cache = new Map()

export function clampAspect(hOverW) {
  if (!Number.isFinite(hOverW) || hOverW <= 0) return 1
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, hOverW))
}

export function clampDetailAspect(hOverW) {
  if (!Number.isFinite(hOverW) || hOverW <= 0) return 1
  return Math.min(DETAIL_ASPECT_MAX, Math.max(DETAIL_ASPECT_MIN, hOverW))
}

/** 封面像素高度：width × aspect，再不超过 viewport * maxVh */
export function detailCoverHeightPx({ aspect, widthPx, maxVh = 0.7 }) {
  const a = clampDetailAspect(aspect)
  const w = Math.max(1, widthPx || (typeof window !== 'undefined' ? window.innerWidth : 390))
  const raw = Math.round(w * a)
  const maxH = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * maxVh)
  return Math.min(raw, maxH)
}

export function loadImageAspect(url) {
  if (!url) return Promise.resolve(NO_IMAGE_ASPECT)
  if (cache.has(url)) return cache.get(url)
  const p = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 1
      const h = img.naturalHeight || 1
      resolve(clampAspect(h / w))
    }
    img.onerror = () => resolve(1)
    img.src = url
  })
  cache.set(url, p)
  return p
}

/** 无帖子明细时沿用图文卡的保守正文估算（含 44px 作者/点赞行）。 */
export const CARD_FOOTER_EST = 140
export const CARD_GAP = 10

/** 汉字近似占满字号，其他字符沿用原估高的 0.65 倍宽度，不依赖 DOM 或当前视口。 */
function estimateTextWidth(text, fontSize) {
  return Array.from(String(text)).reduce((width, char) => (
    width + (/\p{Script=Han}/u.test(char) ? fontSize : fontSize * 0.65)
  ), 0)
}

/**
 * 首页糖果无图头区：标签容器先按内容宽度占位，角色剩余空间不足时自然换到下一行。
 * 与 PostCard 同步使用卡片列宽决定 64/72px 角色区，头区最小高度为 72px；
 * 标签自身仍按 gap 4px 换行，长分类可在标签内部断行，头区不会盖住后续正文。
 */
function estimateCandyHeaderHeight(colWidth, textWidth, post, menu) {
  const fontSize = 11.5
  const badgeGap = 4
  const headerGap = 6
  const artSize = colWidth < 150 ? 64 : 72
  const labels = [getTypeTheme(post.type, menu).label]
  if (post.status === 'closed') labels.push('已结束')
  const naturalWidths = labels.map(label => estimateTextWidth(label, fontSize) + 16)
  const badgesWidth = Math.min(textWidth, naturalWidths.reduce((sum, width) => sum + width, 0) + badgeGap * (labels.length - 1))
  let badgesHeight = 0
  let rowWidth = 0
  let rowHeight = 0
  for (const width of naturalWidths) {
    const badgeWidth = Math.min(badgesWidth, width)
    // 左右各 8px、上下各 5px 与实际 pill 一致；空间不足时按完整文案近似断行。
    const badgeLines = width <= badgeWidth ? 1 : Math.ceil((width - 16) / Math.max(1, badgeWidth - 16))
    const badgeHeight = Math.max(1, badgeLines) * fontSize + 10
    if (rowWidth && rowWidth + badgeGap + badgeWidth > badgesWidth) {
      badgesHeight += rowHeight + badgeGap
      rowWidth = 0
      rowHeight = 0
    }
    rowWidth += (rowWidth ? badgeGap : 0) + badgeWidth
    rowHeight = Math.max(rowHeight, badgeHeight)
  }
  badgesHeight += rowHeight
  return Math.max(72, badgesWidth + headerGap + artSize <= textWidth
    ? Math.max(badgesHeight, artSize)
    : badgesHeight + headerGap + artSize)
}

/**
 * 根据卡片实际显示字段估算列高；无图卡没有封面，不能再加一块虚构的图片高度。
 * 文字宽度仅用于两列的近似均衡，浏览器仍按真实内容排版，不设固定卡片高度。
 * 第四参数只为显式 candy 变体计入角色头区，默认卡与照片封面维持原估高。
 */
export function estimateCardHeight(colWidth, aspect, post, { variant = 'default', menu } = {}) {
  const a = clampAspect(aspect || NO_IMAGE_ASPECT)
  if (!post) return Math.round(colWidth * a) + CARD_FOOTER_EST + CARD_GAP
  const hasImage = !!coverKey(post)
  const textWidth = Math.max(1, colWidth - 24)
  const lines = (text, fontSize, max) => Math.min(max, Math.max(1, Math.ceil(
    estimateTextWidth(text, fontSize) / textWidth
  )))
  const summary = typeof post.content === 'string' ? post.content.replace(/\s+/g, ' ').trim() : ''
  const titleHeight = lines(String(post.title || ''), 15.5, 2) * 15.5 * 1.4
  const summaryHeight = !hasImage && summary ? 8 + lines(summary, 13, 3) * 13 * 1.5 : 0
  const locationHeight = typeof post.location === 'string' && post.location.trim() ? 26 : 0
  // 无图分类标签需要参与正文占位；较窄列的「已结束」标签可能换行。
  const badgesHeight = hasImage ? 0 : (variant === 'candy'
    ? estimateCandyHeaderHeight(colWidth, textWidth, post, menu)
    : (post.status === 'closed' && textWidth < 117 ? 47 : 21.5)) + 10
  return Math.round((hasImage ? colWidth * a : 0) + 24 + badgesHeight + titleHeight + summaryHeight + locationHeight + 50) + CARD_GAP
}
