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

/** 页脚估算高度(标题两行 + 作者行 + padding)，用于砌瀑布流 */
export const CARD_FOOTER_EST = 88
export const CARD_GAP = 10

export function estimateCardHeight(colWidth, aspect) {
  const a = clampAspect(aspect || NO_IMAGE_ASPECT)
  return Math.round(colWidth * a) + CARD_FOOTER_EST + CARD_GAP
}
