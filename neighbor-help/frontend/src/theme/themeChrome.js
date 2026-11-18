// 每个文档独立记录仍挂载的注册页，避免重复实例或 StrictMode 清理释放别人的配色。
const registrationOwners = new WeakMap()

/** 统一写入唯一 theme-color；主题同步和页面申请/释放都走这里，避免父子布局副作用互相覆盖。 */
function applyThemeChrome(doc) {
  const root = doc.documentElement
  const registrationActive = (registrationOwners.get(doc)?.size || 0) > 0
  if (registrationActive) root.dataset.pageChrome = 'registration'
  else delete root.dataset.pageChrome
  const property = registrationActive ? '--registration-hero-start' : '--color-bg'
  const color = doc.defaultView.getComputedStyle(root).getPropertyValue(property).trim()
  if (!color) return
  let meta = doc.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = 'theme-color'
    doc.head.appendChild(meta)
  }
  meta.removeAttribute('media')
  meta.content = color
}

/**
 * 将已解析的明暗主题同步到页面与浏览器栏，尊重当前注册页的临时顶/底安全区配色。
 * 先更新根主题，再读取 CSS 色源；不冻结内联背景、不修改存储或应用的 system 偏好。
 * theme-color 仍仅为浏览器配色提示，实际工具栏表现由 Safari 等浏览器决定。
 * @param {'light' | 'dark'} theme 应用最终主题，不使用系统偏好覆盖手动选择。
 */
export function syncThemeChrome(theme) {
  document.documentElement.dataset.theme = theme
  applyThemeChrome(document)
}

/**
 * 为一个已挂载注册布局申请临时 chrome 配色，返回可重复调用的释放函数。
 * 不缓存旧主题色：最后一个布局离开时读取当前 CSS，切换主题后也能恢复到正确的新底色。
 * @returns {() => void} 布局卸载时调用，仅释放本次申请，不影响其他仍在显示的注册实例。
 */
export function acquireRegistrationChrome() {
  const doc = document
  let owners = registrationOwners.get(doc)
  if (!owners) {
    owners = new Set()
    registrationOwners.set(doc, owners)
  }
  const owner = Symbol('registration-chrome')
  owners.add(owner)
  applyThemeChrome(doc)
  return () => {
    if (!owners.delete(owner)) return
    applyThemeChrome(doc)
  }
}
