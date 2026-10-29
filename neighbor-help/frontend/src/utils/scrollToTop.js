/** 切换 Tab / 筛选后滚回顶部（instant，避免带着底部位置看新列表） */
export function scrollToTop() {
  const el = document.scrollingElement || document.documentElement
  const top = window.scrollY || el?.scrollTop || 0
  if (!top) return
  const jump = () => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    } catch {
      window.scrollTo(0, 0)
    }
    if (el) el.scrollTop = 0
    if (document.body) document.body.scrollTop = 0
  }
  jump()
  // 列表 keepPreviousData / 布局尚未收束时再补一次，避免被后续增高顶回底部观感
  requestAnimationFrame(jump)
}
