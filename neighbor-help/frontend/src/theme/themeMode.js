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
  localStorage.setItem(THEME_KEY, mode)
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
