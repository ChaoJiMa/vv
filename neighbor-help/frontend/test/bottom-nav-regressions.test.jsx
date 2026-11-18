import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useBlocker } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BottomNav from '../src/components/BottomNav'
import { api } from '../src/api'

vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'nav-user' } }) }))
vi.mock('../src/hooks/usePageVisible', () => ({ usePageVisible: () => true, pollInterval: () => false }))

/** 使用真实导航与查询缓存，覆盖被拦截跳转和底栏空闲预取带来的副作用。 */
describe('bottom navigation side effects', () => {
  let root, container, router, client, blocker, y, idleTasks
  const page = number => ({ list: [`page-${number}`], page: number, hasMore: true })
  const keys = [
    ['posts', '', '', 'nav-user'], ['conversations', 'nav-user'],
    ['notifications', 'nav-user'], ['myPosts', '', 'nav-user'],
  ]
  function Editor() {
    blocker = useBlocker(true)
    return <><p>编辑中的页面</p><BottomNav /></>
  }
  async function mount(initialEntries = ['/create']) {
    router = createMemoryRouter([
      { path: '/create', element: <Editor /> },
      { path: '/', element: <><p>首页</p><BottomNav /></> },
      { path: '/discover', element: <><p>发现</p><BottomNav /></> },
    ], { initialEntries })
    await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>))
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(el => el.querySelector('.nh-nav-label')?.textContent.trim() === label)
    expect(button).toBeTruthy()
    await act(async () => button.click())
  }
  async function runIdleTasks() {
    await act(async () => {
      for (const task of [...idleTasks.values()]) task()
      idleTasks.clear()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  beforeEach(() => {
    y = 640
    idleTasks = new Map()
    vi.stubGlobal('requestIdleCallback', callback => { const id = idleTasks.size + 1; idleTasks.set(id, callback); return id })
    vi.stubGlobal('cancelIdleCallback', id => idleTasks.delete(id))
    vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y)
    vi.spyOn(window, 'scrollTo').mockImplementation(options => { y = options.top || 0 })
    vi.spyOn(api, 'getUnread').mockResolvedValue({ total: 0 })
    vi.spyOn(api, 'getPosts').mockImplementation(async (_type, number) => page(number))
    vi.spyOn(api, 'getConversations').mockImplementation(async number => page(number))
    vi.spyOn(api, 'getNotifications').mockImplementation(async number => page(number))
    vi.spyOn(api, 'getMyPosts').mockImplementation(async number => page(number))
    vi.spyOn(api, 'getMyStats').mockResolvedValue({ helped: 0, received: 0 })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    router?.dispose()
    client.clear()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the editor position when navigation is blocked and resets only after proceeding', async () => {
    await mount()
    await click('首页')
    expect(router.state.location.pathname).toBe('/create')
    expect(blocker.state).toBe('blocked')
    expect(y).toBe(640)
    expect(window.scrollTo).not.toHaveBeenCalled()
    await act(async () => blocker.reset())
    expect(y).toBe(640)
    await click('首页')
    await act(async () => blocker.proceed())
    expect(router.state.location.pathname).toBe('/')
    expect(y).toBe(0)
  })

  it('does not turn a populated multi-page query into an idle-prefetch error', async () => {
    for (const key of keys) client.setQueryData(key, { pages: [page(1), page(2)], pageParams: [1, 2] })
    client.setQueryData(['myStats', 'nav-user'], { helped: 2, received: 1 })
    await mount()
    await runIdleTasks()
    for (const key of keys) {
      expect(client.getQueryState(key).status, JSON.stringify(key)).toBe('success')
      expect(client.getQueryData(key).pages.map(value => value.page)).toEqual([1, 2])
    }
    expect(api.getPosts).not.toHaveBeenCalled()
    expect(api.getConversations).not.toHaveBeenCalled()
    expect(api.getNotifications).not.toHaveBeenCalled()
    expect(api.getMyPosts).not.toHaveBeenCalled()
    expect(api.getMyStats).not.toHaveBeenCalled()
  })

  it('does not replay a past tab reset when the browser goes back', async () => {
    await mount([{ pathname: '/', state: { navScrollReset: true } }, '/discover'])
    await act(async () => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/')
    expect(y).toBe(640)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls the selected tab without adding another history entry', async () => {
    await mount(['/', '/discover'])
    await click('发现')
    expect(y).toBe(0)
    await act(async () => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/')
  })

  it('still clears discovery filters when its tab is explicitly selected', async () => {
    await mount(['/discover?type=idle&keyword=lamp'])
    await click('发现')
    expect(router.state.location.pathname).toBe('/discover')
    expect(router.state.location.search).toBe('')
    expect(y).toBe(0)
  })

  it('still warms empty tab caches', async () => {
    await mount()
    await runIdleTasks()
    for (const key of keys) {
      expect(client.getQueryState(key).status).toBe('success')
      expect(client.getQueryData(key).pages.map(value => value.page)).toEqual([1])
    }
    expect(api.getPosts).toHaveBeenCalledWith('', 1, '')
  })
})
