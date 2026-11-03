import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { AppThemeContext } from './themeContext'
import { getStoredMode, getSystemDark, resolveTheme, setStoredMode } from './themeMode'
import { syncThemeChrome } from './themeChrome'

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

  // 在绘制前同步，避免内容、表单和浏览器栏在主题切换时分别换色。
  useLayoutEffect(() => {
    syncThemeChrome(theme)
  }, [theme])

  const setMode = useCallback((next) => {
    setStoredMode(next)
    setModeState(next)
  }, [])

  const value = useMemo(() => ({ mode, theme, setMode }), [mode, theme, setMode])

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  )
}
