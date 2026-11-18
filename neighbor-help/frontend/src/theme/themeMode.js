export const THEME_KEY = 'nh-theme'

/** @returns {'light' | 'dark' | 'system'} */
export function getStoredMode() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

/** @param {'light' | 'dark' | 'system'} mode */
export function setStoredMode(mode) {
  // 隐私模式可能禁止持久化，但本次页面中的主题切换仍应正常生效。
  try { localStorage.setItem(THEME_KEY, mode) } catch { /* 本次会话继续使用所选主题 */ }
}

/**
 * @param {'light' | 'dark' | 'system'} mode
 * @param {boolean} systemDark
 * @returns {'light' | 'dark'}
 */
export function resolveTheme(mode, systemDark) {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

export function getSystemDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
