import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../src/pages/Login'
import { MockAuthProvider } from '../src/hooks/useAuth'
import { api } from '../src/api'

const calls = vi.hoisted(() => ({ login: vi.fn() }))

// 认证状态真实触发父级 user effect，但不会写 token、访问网络或创建真实账号。
vi.mock('../src/hooks/useAuth', async () => {
  const { createContext, useContext, useState } = await import('react')
  const context = createContext(null)
  function MockAuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const login = (token, nextUser) => { calls.login(token, nextUser); setUser(nextUser) }
    return <context.Provider value={{ user, login }}>{children}</context.Provider>
  }
  return { MockAuthProvider, useAuth: () => useContext(context) }
})

// 本文件只验证 Login 与路由衔接；实际注册字段、邀请码和提交行为由表单用例独立覆盖。
vi.mock('../src/pages/RegistrationForm', () => ({
  default: function MockRegistrationForm({ onSuccess, onBusyChange, onLogin }) {
    return <div>
      <button type="button" onClick={() => onBusyChange(true)}>模拟注册忙碌</button>
      <button type="button" onClick={() => onBusyChange(false)}>模拟结束忙碌</button>
      <button type="button" onClick={() => onSuccess('local-test-token', { id: 'local-neighbor' })}>模拟注册成功</button>
      <button type="button" onClick={onLogin}>已有账号去登录</button>
    </div>
  },
}))
vi.mock('../src/api', () => ({ api: {
  loginWithCode: vi.fn(), loginWithPassword: vi.fn(), register: vi.fn(), getRegistrationOptions: vi.fn(),
} }))
vi.mock('../src/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

// 路由用例不验证 MUI 绘制；隔离其 Node ESM 兼容边界，真实抽屉交互另作实页验收。
vi.mock('@mui/material/Box', () => ({
  default: function MockBox(props) {
    const forwarded = { ...props }
    const Component = forwarded.component || 'div'
    delete forwarded.component
    delete forwarded.sx
    return <Component {...forwarded} />
  },
}))
vi.mock('@mui/material/Typography', () => ({
  default: function MockTypography(props) {
    const forwarded = { ...props }
    const Component = forwarded.component || 'span'
    delete forwarded.component
    delete forwarded.sx
    return <Component {...forwarded} />
  },
}))
vi.mock('@mui/material/TextField', () => ({
  default: function MockTextField({ label, value, onChange, autoComplete, type = 'text' }) {
    return <label>{label}<input type={type} value={value} onChange={onChange} autoComplete={autoComplete} /></label>
  },
}))
vi.mock('@mui/material/CircularProgress', () => ({ default: () => null }))
vi.mock('@mui/material/Button', () => ({
  default: function MockButton({ children, type = 'button', disabled, onClick }) {
    return <button type={type} disabled={disabled} onClick={onClick}>{children}</button>
  },
}))
vi.mock('../src/components/BottomSheet', () => ({
  default: function MockBottomSheet({ open, title, children, className }) {
    return open ? <section role="dialog" aria-label={title} className={className}>
      <h2>{title}</h2>{children}
    </section> : null
  },
}))

/** 挂载真实登录逻辑与注册布局，隔离表单和视觉外壳，覆盖 URL 历史与登录前来源的往返。 */
describe('login registration route continuity', () => {
  let root, container, router
  const from = { pathname: '/create', search: '?x=registration%20return&type=help' }
  const entryState = { from, source: 'local-test' }

  async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  }

  async function mount({ search = '', state = entryState, previous = false } = {}) {
    const entry = { pathname: '/login', search, state }
    router = createMemoryRouter([
      { path: '/login', element: <Login /> },
      { path: '/create', element: <div>原发布页面</div> },
      { path: '/outside', element: <div>站外历史占位</div> },
      { path: '/', element: <div>首页占位</div> },
    ], { initialEntries: previous ? ['/outside', entry] : [entry] })
    await act(async () => root.render(<MockAuthProvider><RouterProvider router={router} /></MockAuthProvider>))
    await settle()
  }

  function button(label) {
    const element = [...document.querySelectorAll('button')].find(item =>
      item.getAttribute('aria-label') === label || item.textContent.trim() === label
    )
    expect(element, label).toBeTruthy()
    return element
  }

  async function click(label) {
    await act(async () => button(label).click())
    await settle()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    router = undefined
    vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('unexpected network request'))))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    router?.dispose()
    container.remove()
    expect(fetch).not.toHaveBeenCalled()
    expect(api.register).not.toHaveBeenCalled()
    expect(api.loginWithPassword).not.toHaveBeenCalled()
    expect(api.loginWithCode).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens registration in the URL while preserving the protected destination and entry state', async () => {
    await mount()
    await click('注册账号')
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?view=register')
    expect(router.state.location.state).toMatchObject({ ...entryState, registrationEntry: true })
    expect(container.querySelector('h1')?.textContent).toBe('欢迎成为新邻居')
  })

  it('returns from registration to the same login entry and preserves its source', async () => {
    await mount()
    await click('注册账号')
    await click('返回登录')
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
    expect(router.state.location.state).toEqual(entryState)
    expect(button('账号密码登录')).toBeTruthy()
    expect(container.textContent).not.toContain('欢迎成为新邻居')
  })

  it('returns a direct registration link to login instead of leaving through earlier history', async () => {
    await mount({ search: '?view=register', previous: true })
    await click('返回登录')
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.state.from).toEqual(from)
    expect(container.textContent).not.toContain('站外历史占位')
  })

  it.each(['entry', 'direct'])('opens the original account drawer from the %s registration form', async kind => {
    await mount({ search: kind === 'direct' ? '?view=register' : '', previous: kind === 'direct' })
    if (kind === 'entry') await click('注册账号')
    await click('已有账号去登录')
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
    const drawer = document.querySelector('.nh-login-drawer')
    expect(drawer).toBeTruthy()
    expect(drawer.querySelector('h2')?.textContent).toBe('账号登录')
    expect(drawer.querySelector('input[autocomplete="username"]')).toBeTruthy()
    expect(drawer.querySelector('input[autocomplete="current-password"]')).toBeTruthy()
    expect(router.state.location.state.from).toEqual(from)
  })

  it('uses the updated auth user to return to the original destination after registration succeeds', async () => {
    await mount()
    await click('注册账号')
    await click('模拟注册成功')
    expect(calls.login).toHaveBeenCalledExactlyOnceWith('local-test-token', { id: 'local-neighbor' })
    expect(router.state.location.pathname).toBe(from.pathname)
    expect(router.state.location.search).toBe(from.search)
    expect(container.textContent).toBe('原发布页面')
  })

  it('disables the real guide back control while registration is busy', async () => {
    await mount()
    await click('注册账号')
    await click('模拟注册忙碌')
    expect(button('返回登录').disabled).toBe(true)
    await click('返回登录')
    expect(router.state.location.search).toBe('?view=register')
    await click('模拟结束忙碌')
    expect(button('返回登录').disabled).toBe(false)
    await click('返回登录')
    expect(router.state.location.search).toBe('')
  })
})
