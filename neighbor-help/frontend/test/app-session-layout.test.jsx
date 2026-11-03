import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { api } from '../src/api'
import { useAuth } from '../src/hooks/useAuth'

const controls = vi.hoisted(() => ({ router: null, failDiscover: false }))
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    createBrowserRouter: (...args) => {
      controls.router = actual.createBrowserRouter(...args)
      return controls.router
    },
  }
})

// 仅省略业务页的数据和排版；App、浏览器路由、鉴权守卫与会话恢复均使用真实实现。
function SessionPage({ name }) {
  const { user, loading } = useAuth()
  return <div data-page={name}>{loading ? '正在恢复' : user?.id || '匿名'}</div>
}
vi.mock('../src/pages/Home', () => ({ default: () => <SessionPage name="home" /> }))
vi.mock('../src/pages/Discover', () => ({ default: () => {
  if (controls.failDiscover) throw new Error('fixture page failure')
  return <SessionPage name="discover" />
} }))
vi.mock('../src/pages/Profile', () => ({ default: () => <SessionPage name="profile" /> }))
vi.mock('../src/pages/Login', () => ({ default: () => <SessionPage name="login" /> }))

/** App 级回归：开发预览无账号请求，历史进入产品时恢复，业务切换与路由错误不重建会话。 */
describe('application session route boundary', () => {
  let root, container
  const user = { id: 'fixture-neighbor', nickname: '邻居' }

  async function waitFor(check) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (check()) return
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    expect(check()).toBeTruthy()
  }
  async function mount() {
    await act(async () => root.render(<App />))
  }
  async function navigate(path, options) {
    await act(async () => { await controls.router.navigate(path, options) })
  }
  const page = name => container.querySelector(`[data-page="${name}"]`)
  const isPreview = () => container.textContent.includes('角色组合')

  beforeEach(async () => {
    localStorage.clear()
    controls.failDiscover = false
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
    vi.spyOn(api, 'getMe').mockResolvedValue(user)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await navigate('/dev/characters', { replace: true })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens the actual development playground with a saved token without restoring an account', async () => {
    localStorage.setItem('token', 'fixture-session')
    await mount()
    await waitFor(isPreview)
    expect(container.querySelectorAll('.nh-character-playground-expressions button')).toHaveLength(12)
    expect(api.getMe).not.toHaveBeenCalled()
  })

  it('restores an ordinary page once and retains the same account across public and protected routes', async () => {
    localStorage.setItem('token', 'fixture-session')
    await navigate('/', { replace: true })
    await mount()
    await waitFor(() => page('home')?.textContent === user.id)
    await navigate('/discover')
    await waitFor(() => page('discover')?.textContent === user.id)
    await navigate('/profile')
    await waitFor(() => page('profile')?.textContent === user.id)
    expect(api.getMe).toHaveBeenCalledTimes(1)
  })

  it('mounts session restoration when browser history returns from the development page to an ordinary page', async () => {
    localStorage.setItem('token', 'fixture-session')
    await navigate('/', { replace: true })
    await navigate('/dev/characters')
    await mount()
    await waitFor(isPreview)
    expect(api.getMe).not.toHaveBeenCalled()
    await navigate(-1)
    await waitFor(() => page('home')?.textContent === user.id)
    await navigate('/discover')
    await waitFor(() => page('discover')?.textContent === user.id)
    expect(api.getMe).toHaveBeenCalledTimes(1)
  })

  it('keeps protected product routes behind the existing anonymous login redirect', async () => {
    await navigate('/profile', { replace: true })
    await mount()
    await waitFor(() => page('login')?.textContent === '匿名')
    expect(controls.router.state.location.pathname).toBe('/login')
    expect(controls.router.state.location.state.from.pathname).toBe('/profile')
    expect(api.getMe).not.toHaveBeenCalled()
  })

  it('uses RouteError inside the product layout and recovers without restoring the session again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('token', 'fixture-session')
    await navigate('/', { replace: true })
    await mount()
    await waitFor(() => page('home')?.textContent === user.id)
    controls.failDiscover = true
    await navigate('/discover')
    await waitFor(() => container.textContent.includes('页面暂时无法打开'))
    await navigate('/')
    await waitFor(() => page('home')?.textContent === user.id)
    expect(api.getMe).toHaveBeenCalledTimes(1)
  })
})
