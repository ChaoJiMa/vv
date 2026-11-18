import { act, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppThemeProvider } from '../src/theme/ThemeProvider'
import { useAppTheme } from '../src/theme/useAppTheme'
import { syncThemeChrome } from '../src/theme/themeChrome'
import ChromePad from '../src/components/ChromePad'
import RegistrationGuide from '../src/pages/RegistrationGuide'
import indexHtml from '../index.html?raw'
import tokensCss from '../src/styles/tokens.css?raw'
import indexCss from '../src/index.css?raw'

const template = new JSDOM(indexHtml)
const themeCss = template.window.document.querySelector('#nh-page-theme').textContent
template.window.close()

/** 从真实入口运行经典脚本；不加载 React，也不伪造计算颜色函数。 */
describe('首屏主题恢复', () => {
  const pages = []

  function boot({ mode = null, systemDark = false, blockedStorage = false, colors, url = 'https://neighbor.test/' } = {}) {
    let html = indexHtml
    if (colors) {
      // 只改变入口中的颜色源，检查脚本及后续 token 不会另用一份硬编码颜色。
      const source = new JSDOM(html)
      source.window.document.querySelector('#nh-page-theme').textContent += `
        :root { --color-bg: ${colors.light}; }
        :root[data-theme="dark"] { --color-bg: ${colors.dark}; }
      `
      const tokens = source.window.document.createElement('style')
      tokens.textContent = tokensCss
      source.window.document.head.append(tokens)
      html = source.serialize()
      source.window.close()
    }
    const page = new JSDOM(html, {
      url,
      runScripts: 'dangerously',
      beforeParse(window) {
        window.matchMedia = () => ({ matches: systemDark })
        if (blockedStorage) {
          Object.defineProperty(window, 'localStorage', {
            get() { throw new window.DOMException('Storage disabled', 'SecurityError') },
          })
        } else if (mode !== null) {
          window.localStorage.setItem('nh-theme', mode)
        }
      },
    })
    pages.push(page)
    return page.window
  }

  function expectChrome(window, theme, registration = false) {
    const root = window.document.documentElement
    const color = window.getComputedStyle(root).getPropertyValue(registration ? '--registration-hero-start' : '--color-bg').trim()
    const metas = window.document.querySelectorAll('meta[name="theme-color"]')
    expect(root.dataset.theme).toBe(theme)
    expect(root.dataset.pageChrome).toBe(registration ? 'registration' : undefined)
    expect(color).not.toBe('')
    expect(metas).toHaveLength(1)
    expect(metas[0].content).toBe(color)
    expect(metas[0].hasAttribute('media')).toBe(false)
  }

  afterEach(() => {
    pages.splice(0).forEach(page => page.window.close())
  })

  it.each([
    { mode: 'light', systemDark: true, theme: 'light' },
    { mode: 'dark', systemDark: false, theme: 'dark' },
    { mode: 'system', systemDark: true, theme: 'dark' },
    { mode: 'system', systemDark: false, theme: 'light' },
    { mode: 'invalid-old-mode', systemDark: true, theme: 'dark' },
    { mode: 'invalid-old-mode', systemDark: false, theme: 'light' },
    { mode: null, systemDark: true, theme: 'dark' },
  ])('模块启动前恢复 $mode，系统深色=$systemDark 时使用 $theme', options => {
    expectChrome(boot(options), options.theme)
  })

  it.each([false, true])('存储禁止时仍按系统偏好恢复，系统深色=%s', systemDark => {
    expectChrome(boot({ blockedStorage: true, systemDark }), systemDark ? 'dark' : 'light')
  })

  it.each(['light', 'dark'])('首屏与后加载 token 共用入口定义的 %s 底色', theme => {
    const colors = { light: '#f0ddec', dark: '#182132' }
    const window = boot({ mode: theme, systemDark: theme !== 'dark', colors })
    expectChrome(window, theme)
    expect(window.document.querySelector('meta[name="theme-color"]').content).toBe(colors[theme])
  })

  it.each(['light', 'dark'])('直接刷新注册深链时，%s 首帧使用对应头图起色且不改主题偏好', mode => {
    const window = boot({ mode, url: 'https://neighbor.test/login?view=register' })
    expectChrome(window, mode, true)
    expect(window.document.querySelector('meta[name="theme-color"]').content).toBe(mode === 'dark' ? '#d4b75e' : '#fff08c')
    expect(window.localStorage.getItem('nh-theme')).toBe(mode)
  })

  it.each(['/login', '/login?view=other', '/?view=register', '/discover?view=register'])('地址 %s 不提前套用注册页提示色', path => {
    expectChrome(boot({ mode: 'dark', url: `https://neighbor.test${path}` }), 'dark')
  })
})

/** 渲染真实 Provider，检查主题控制、CSS 配色与浏览器提示的生命周期。 */
describe('运行期主题与浏览器底色', () => {
  let root, container, theme, media, listeners, styles, meta, observations

  function Probe() {
    const appTheme = useAppTheme()
    const effectiveTheme = appTheme.theme
    theme = appTheme
    useEffect(() => {
      observations.push({
        theme: effectiveTheme,
        dataset: document.documentElement.dataset.theme,
        color: document.querySelector('meta[name="theme-color"]')?.content,
      })
    }, [effectiveTheme])
    return <span>{appTheme.mode}:{effectiveTheme}</span>
  }

  async function mount({ registration = false, secondRegistration = false, strict = false } = {}) {
    const content = <AppThemeProvider>
      <Probe />
      <ChromePad />
      {registration && <RegistrationGuide onBack={() => {}}>注册字段占位</RegistrationGuide>}
      {secondRegistration && <RegistrationGuide onBack={() => {}}>第二注册布局</RegistrationGuide>}
    </AppThemeProvider>
    await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content))
  }

  async function systemChanges(dark) {
    await act(async () => {
      media.matches = dark
      listeners.forEach(listener => listener({ matches: dark, media: media.media }))
    })
  }

  /** jsdom 不展开自定义属性中的 var；读取实际 CSS 别名指向的色源，不伪造计算样式或复制配色表。 */
  function themeToken(property) {
    const style = getComputedStyle(document.documentElement)
    const value = style.getPropertyValue(property).trim()
    const alias = /^var\((--[\w-]+)\)$/.exec(value)
    return alias ? style.getPropertyValue(alias[1]).trim() : value
  }

  function expectChrome(expected, registration = false) {
    const rootElement = document.documentElement
    const color = getComputedStyle(rootElement).getPropertyValue(registration ? '--registration-hero-start' : '--color-bg').trim()
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    expect(theme.theme).toBe(expected)
    expect(rootElement.dataset.theme).toBe(expected)
    expect(rootElement.dataset.pageChrome).toBe(registration ? 'registration' : undefined)
    expect(color).not.toBe('')
    expect(metas).toHaveLength(1)
    expect(metas[0].content).toBe(color)
    expect(metas[0].hasAttribute('media')).toBe(false)
    // 根节点不冻结色值，后续 CSS token 更新与页面安全区仍能共用同一颜色。
    expect(rootElement.style.backgroundColor).toBe('')
    expect(document.body.style.backgroundColor).toBe('')
  }

  beforeEach(() => {
    localStorage.clear()
    observations = []
    listeners = new Set()
    media = {
      media: '(prefers-color-scheme: dark)',
      matches: false,
      addEventListener: vi.fn((type, listener) => { if (type === 'change') listeners.add(listener) }),
      removeEventListener: vi.fn((type, listener) => { if (type === 'change') listeners.delete(listener) }),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-page-chrome')
    document.documentElement.removeAttribute('style')
    styles = document.createElement('style')
    styles.textContent = `${themeCss}\n${tokensCss}\n${indexCss.replace(/^@import[^;]+;/m, '')}`
    document.head.append(styles)
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.media = '(prefers-color-scheme: dark)'
    document.head.append(meta)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    container.remove()
    styles.remove()
    document.querySelectorAll('meta[name="theme-color"]').forEach(element => element.remove())
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-page-chrome')
    document.documentElement.removeAttribute('style')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('恢复手动深色时先同步页面与 meta，子组件被动副作用不会读到浅色', async () => {
    localStorage.setItem('nh-theme', 'dark')
    document.documentElement.dataset.theme = 'light'
    await mount()
    expect(theme.mode).toBe('dark')
    expectChrome('dark')
    expect(observations).toEqual([{
      theme: 'dark', dataset: 'dark',
      color: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
    }])
  })

  it('手动选择覆盖系统，切回 system 后立即使用最新系统偏好', async () => {
    media.matches = true
    localStorage.setItem('nh-theme', 'light')
    await mount()
    expectChrome('light')
    await systemChanges(false)
    await systemChanges(true)
    expectChrome('light')
    await act(async () => theme.setMode('system'))
    expect(theme.mode).toBe('system')
    expect(localStorage.getItem('nh-theme')).toBe('system')
    expectChrome('dark')
    await systemChanges(false)
    expectChrome('light')
  })

  it('系统模式跟随 OS，并在卸载时移除同一个监听函数', async () => {
    await mount()
    expect(theme.mode).toBe('system')
    expectChrome('light')
    expect(listeners.size).toBe(1)
    const listener = [...listeners][0]
    await systemChanges(true)
    expectChrome('dark')
    await act(async () => root.unmount())
    root = null
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
    expect(listeners.size).toBe(0)
  })

  it('读取与写入存储都被禁止时，本页仍能手动切换主题', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage disabled', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage disabled', 'SecurityError') })
    media.matches = true
    await mount()
    expect(theme.mode).toBe('system')
    expectChrome('dark')
    await act(async () => theme.setMode('light'))
    expect(theme.mode).toBe('light')
    expectChrome('light')
    await systemChanges(false)
    await systemChanges(true)
    expectChrome('light')
  })

  it('反复切换复用单一 meta，不启动 ViewTransition 或 body 背景过渡', async () => {
    const startTransition = vi.fn(callback => callback())
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startTransition })
    try {
      await mount()
      for (const mode of ['dark', 'light', 'dark', 'system']) {
        await act(async () => theme.setMode(mode))
        expectChrome(mode === 'system' ? 'light' : mode)
        expect(document.querySelector('meta[name="theme-color"]')).toBe(meta)
      }
      expect(startTransition).not.toHaveBeenCalled()
      const bodyStyle = getComputedStyle(document.body)
      expect(`${bodyStyle.transition} ${bodyStyle.transitionProperty}`).not.toMatch(/background(?:-color)?|\ball\b/)
    } finally {
      delete document.startViewTransition
    }
  })

  it('缺少 meta 时可恢复，并从更新后的 CSS token 读取颜色而非固定色值', () => {
    meta.remove()
    styles.textContent += '\n:root[data-theme="dark"] { --color-bg: #1c2438; }'
    syncThemeChrome('dark')
    const created = document.querySelector('meta[name="theme-color"]')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(created.content).toBe('#1c2438')
    syncThemeChrome('light')
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(document.querySelector('meta[name="theme-color"]')).toBe(created)
    expect(created.content).toBe(getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())
  })

  it('注册子布局先申请后，父主题布局仍保留暖金顶色与当前表单底安全区', async () => {
    localStorage.setItem('nh-theme', 'dark')
    document.documentElement.dataset.theme = 'light'
    await mount({ registration: true })
    expectChrome('dark', true)
    expect(meta.content).toBe('#d4b75e')
    expect(observations).toEqual([{ theme: 'dark', dataset: 'dark', color: '#d4b75e' }])
    expect(container.querySelector('.nh-page-safe-top').getAttribute('aria-hidden')).toBe('true')
    expect(themeToken('--registration-form-bg')).toBe(themeToken('--color-bg'))
    expect(themeToken('--registration-input-bg')).toBe(themeToken('--color-surface'))
    expect(localStorage.getItem('nh-theme')).toBe('dark')
  })

  it('注册时跟随系统变色，退出读取当前主题恢复而不是旧颜色，且不保存新偏好', async () => {
    await mount({ registration: true })
    expectChrome('light', true)
    expect(meta.content).toBe('#fff08c')
    const lightForm = themeToken('--registration-form-bg')
    const lightInput = themeToken('--registration-input-bg')
    expect(lightForm).toBe('#ffffff')
    expect(lightInput).toBe('#f3f3f3')
    await systemChanges(true)
    expectChrome('dark', true)
    expect(meta.content).toBe('#d4b75e')
    expect(themeToken('--registration-form-bg')).toBe(themeToken('--color-bg'))
    expect(themeToken('--registration-input-bg')).toBe(themeToken('--color-surface'))
    expect(themeToken('--registration-form-bg')).not.toBe(lightForm)
    expect(themeToken('--registration-input-bg')).not.toBe(lightInput)
    // 反向切换也恢复浅色面板 / 输入，原注册实例和暖金 chrome 生命周期不重建。
    await systemChanges(false)
    expectChrome('light', true)
    expect(themeToken('--registration-form-bg')).toBe(lightForm)
    expect(themeToken('--registration-input-bg')).toBe(lightInput)
    await systemChanges(true)
    await mount()
    expectChrome('dark')
    expect(meta.content).toBe(getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())
    expect(localStorage.getItem('nh-theme')).toBeNull()
  })

  it('注册期间手动切主题继续使用头图提示色，离开后保留用户已选主题', async () => {
    await mount({ registration: true })
    await act(async () => theme.setMode('dark'))
    expectChrome('dark', true)
    expect(themeToken('--registration-form-bg')).toBe(themeToken('--color-bg'))
    await act(async () => theme.setMode('light'))
    expectChrome('light', true)
    expect(themeToken('--registration-form-bg')).toBe('#ffffff')
    await mount()
    expectChrome('light')
    expect(localStorage.getItem('nh-theme')).toBe('light')
  })

  it('两个注册实例各自释放，仅最后一个离开才恢复基础提示色', async () => {
    await mount({ registration: true, secondRegistration: true })
    expectChrome('light', true)
    await mount({ secondRegistration: true })
    expectChrome('light', true)
    await mount()
    expectChrome('light')
  })

  it('StrictMode 重新挂载与最终卸载不会泄漏注册配色或重复 meta', async () => {
    localStorage.setItem('nh-theme', 'dark')
    await mount({ registration: true, strict: true })
    expectChrome('dark', true)
    await act(async () => root.unmount())
    root = null
    expect(document.documentElement.dataset.pageChrome).toBeUndefined()
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(meta.content).toBe(getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())
    expect(localStorage.getItem('nh-theme')).toBe('dark')
  })

  it('首帧注册标记没有实际布局接管时，普通应用同步立即还原而不残留', async () => {
    document.documentElement.dataset.pageChrome = 'registration'
    meta.content = '#fff08c'
    await mount()
    expectChrome('light')
  })
})
