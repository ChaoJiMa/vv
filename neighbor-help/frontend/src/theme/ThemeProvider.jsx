import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppThemeContext } from './themeContext'
import { getStoredMode, getSystemDark, resolveTheme, setStoredMode } from './themeMode'

export function AppThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => getStoredMode())
  const [systemDark, setSystemDark] = useState(() => getSystemDark())

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(mode, systemDark)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // iOS Safari 顶/底栏：theme-color + 根节点底色；Safari 对「只改 content」不敏感，整段 meta 重建更稳
    syncBrowserChrome(theme)
  }, [theme])

  const setMode = useCallback((next) => {
    const apply = () => {
      setStoredMode(next)
      setModeState(next)
    }
    // 平滑明暗切换；不支持 View Transition 的浏览器退化为即时切换
    if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      document.startViewTransition(apply)
    } else {
      apply()
    }
  }, [])

  const value = useMemo(() => ({ mode, theme, setMode }), [mode, theme, setMode])

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  )
}

const THEME_CHROME = {
  light: '#fff8f2',
  dark: '#1a1614',
}

/** 同步 iOS Safari / 浏览器铬色（地址栏、底栏、灵动岛下）与页面底色 */
function syncBrowserChrome(theme) {
  const color = THEME_CHROME[theme] || THEME_CHROME.light
  const root = document.documentElement
  root.style.colorScheme = theme
  root.style.backgroundColor = color
  root.style.setProperty('--chrome-color', color)
  // 不写 body.style.backgroundColor：登录页会临时改 body，写 hex 会互相覆盖；
  // 橡皮筋露底靠 html 底色 + CSS body { background: var(--color-bg) }

  // Safari 底栏有时读 media=prefers-color-scheme 的 theme-color，顶栏读无 media 的。
  // 三份都写成「当前应用主题色」，避免系统浅色时 App 深色底栏仍发白。
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove())
  const specs = [
    { content: color },
    { content: color, media: '(prefers-color-scheme: light)' },
    { content: color, media: '(prefers-color-scheme: dark)' },
  ]
  for (const spec of specs) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', spec.content)
    if (spec.media) meta.setAttribute('media', spec.media)
    document.head.appendChild(meta)
  }
}
