import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Discover from '../src/pages/Discover'
import { api } from '../src/api'

vi.mock('../src/components/BottomNav', () => ({ default: () => null }))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))

/** 使用真实发现页和查询缓存验证 URL、浏览器历史、异步列表与滚动恢复的衔接。 */
describe('discover browsing continuity', () => {
  let container, root, router, client, y, frames, frameId, observers, nextKey = 0
  const menus = [{ value: 'help', label: '求助互助' }, { value: 'idle', label: '闲置转让' }]
  const post = id => ({ id, type: 'help', title: '测试邻里求助', content: '需要临时借用推车', images: [], status: 'open' })
  const page = (number = 1, hasMore = false) => ({ list: [post(`p${number}`)], page: number, hasMore })
  async function tick() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    // 显式推进帧回调，确保每次断言发生在查询通知、列宽测量和两帧恢复全部结束后。
    for (let round = 0; round < 5 && frames.size; round++) {
      const callbacks = [...frames.values()]
      frames.clear()
      await act(async () => { callbacks.forEach(callback => callback(0)) })
    }
  }

  async function mount(url = '/discover', key = `discover-${++nextKey}`, history) {
    router = createMemoryRouter([
      { path: '/discover', element: <Discover /> },
      { path: '/note/:id', element: <div>帖子详情</div> },
    ], { initialEntries: history || [{ pathname: '/discover', search: url.replace('/discover', ''), key }] })
    await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>))
    await tick()
    return key
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label || el.textContent.trim() === label)
    expect(button, label).toBeTruthy()
    await act(async () => button.click())
    await tick()
  }
  async function input(text) {
    const element = container.querySelector('input[aria-label="搜索标题或内容"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, text)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  beforeEach(() => {
    sessionStorage.clear()
    y = 0
    frames = new Map()
    observers = []
    frameId = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y)
    vi.spyOn(window, 'scrollTo').mockImplementation(options => { y = options.top || 0 })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.active = false; observers.push(this) }
      observe() { this.active = true }
      disconnect() { this.active = false }
      enter() { if (this.active) this.callback([{ isIntersecting: true }]) }
    })
    vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
    vi.spyOn(api, 'getMenus').mockResolvedValue(menus)
    vi.spyOn(api, 'getPosts').mockResolvedValue(page())
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
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

  it('reads filters from a direct URL and keeps them when changing categories', async () => {
    await mount('/discover?type=help&keyword=%E6%8E%A8%E8%BD%A6&extra=keep')
    expect(api.getPosts).toHaveBeenCalledWith('help', 1, '推车')
    expect(container.textContent).toContain('搜索「推车」')
    await click('闲置转让')
    expect(new URLSearchParams(router.state.location.search).get('keyword')).toBe('推车')
    expect(new URLSearchParams(router.state.location.search).get('extra')).toBe('keep')
    expect(api.getPosts).toHaveBeenLastCalledWith('idle', 1, '推车')
  })

  it('submits a trimmed search, collapses the field and can reopen or clear it', async () => {
    await mount('/discover?type=help')
    await click('搜索')
    await input('  推车  ')
    await click('搜索')
    expect(new URLSearchParams(router.state.location.search).get('keyword')).toBe('推车')
    expect(container.querySelector('input')).toBeNull()
    await click('搜索')
    expect(container.querySelector('input').value).toBe('推车')
    await click('收起搜索')
    expect(container.querySelector('input')).toBeNull()
    await click('清除')
    expect(router.state.location.search).toBe('?type=help')
    // 清除后复用原分类的有效缓存，无需为证明恢复而强制重复请求。
    expect(api.getPosts).toHaveBeenCalledWith('help', 1, '')
  })

  it('restores the same filtered list and position after visiting a detail', async () => {
    await mount('/discover?type=help&keyword=%E6%8E%A8%E8%BD%A6')
    y = 720
    window.dispatchEvent(new Event('scroll'))
    await act(async () => router.navigate('/note/p1'))
    y = 0
    await act(async () => router.navigate(-1))
    await tick()
    expect(router.state.location.search).toContain('keyword=')
    expect(container.textContent).toContain('搜索「推车」')
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 720, left: 0, behavior: 'instant' })
  })

  it('returns to the older query and scroll position through browser history', async () => {
    await mount('/discover?type=help')
    y = 560
    window.dispatchEvent(new Event('scroll'))
    await click('闲置转让')
    expect(y).toBe(0)
    await act(async () => router.navigate(-1))
    await tick()
    expect(api.getPosts).toHaveBeenCalledWith('help', 1, '')
    expect(new URLSearchParams(router.state.location.search).get('type')).toBe('help')
    expect(y).toBe(560)
  })

  it('keeps the last reading coordinate when the outgoing document shrinks', async () => {
    await mount('/discover?type=help')
    y = 640
    window.dispatchEvent(new Event('scroll'))
    // 模拟旧布局移除时浏览器先把文档位置截断；卸载清理不能用这个新值覆盖阅读坐标。
    y = 80
    await act(async () => router.navigate('/note/p1'))
    y = 0
    await act(async () => router.navigate(-1))
    await tick()
    expect(y).toBe(640)
  })

  it('refetches previously viewed pages before restoring after cache loss', async () => {
    client.setQueryData(['posts', 'help', '', undefined], { pages: [page(1, true), page(2)], pageParams: [1, 2] })
    await mount('/discover?type=help')
    y = 1100
    window.dispatchEvent(new Event('scroll'))
    await act(async () => router.navigate('/note/p2'))
    client.clear()
    api.getPosts.mockImplementation(async (_type, number) => page(number, number === 1))
    y = 0
    await act(async () => router.navigate(-1))
    await tick()
    await tick()
    expect(api.getPosts).toHaveBeenCalledWith('help', 2, '')
    expect(y).toBe(1100)
  })

  it('continues the original position restoration after a failed page is manually retried', async () => {
    client.setQueryData(['posts', 'help', '', undefined], { pages: [page(1, true), page(2)], pageParams: [1, 2] })
    await mount('/discover?type=help')
    y = 1100
    window.dispatchEvent(new Event('scroll'))
    await act(async () => router.navigate('/note/p2'))
    client.clear()
    let failOlderPage = true
    api.getPosts.mockImplementation(async (_type, number) => {
      if (number === 2 && failOlderPage) throw new Error('temporary network failure')
      return page(number, number === 1)
    })
    y = 0
    await act(async () => router.navigate(-1))
    await tick()
    await tick()
    const failedCalls = api.getPosts.mock.calls.length
    await tick()
    expect(api.getPosts).toHaveBeenCalledTimes(failedCalls)
    expect(container.textContent).toContain('加载更多失败，已有内容已保留')
    failOlderPage = false
    await click('重试加载更多')
    await tick()
    expect(y).toBe(1100)
    expect(container.textContent).not.toContain('加载更多失败，已有内容已保留')
  })

  it('identifies old results while a new filter is still loading', async () => {
    await mount('/discover?type=help')
    let resolve
    api.getPosts.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
    await click('闲置转让')
    expect(container.querySelector('[role="status"]').textContent).toBe('正在更新筛选结果…')
    await act(async () => resolve(page()))
    await tick()
    expect(container.textContent).not.toContain('正在更新筛选结果…')
  })

  it('does not show an empty result from the previous category while the new category is loading', async () => {
    api.getPosts.mockResolvedValueOnce({ list: [], page: 1, hasMore: false })
    await mount('/discover?type=help')
    expect(container.textContent).toContain('这里还空着')
    let resolve
    api.getPosts.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
    await click('闲置转让')
    expect(container.textContent).toContain('正在更新筛选结果…')
    expect(container.textContent).not.toContain('这里还空着')
    expect(container.querySelector('.nh-skeleton')).toBeTruthy()
    await act(async () => resolve(page()))
    await tick()
  })

  it('lets the user take over scrolling while saved pages are still loading', async () => {
    client.setQueryData(['posts', 'help', '', undefined], { pages: [page(1, true), page(2)], pageParams: [1, 2] })
    await mount('/discover?type=help')
    y = 1100
    window.dispatchEvent(new Event('scroll'))
    await act(async () => router.navigate('/note/p2'))
    client.clear()
    let resolveOlder
    api.getPosts.mockImplementation(async (_type, number) => number === 1
      ? page(1, true)
      : new Promise(resolve => { resolveOlder = resolve }))
    y = 0
    await act(async () => router.navigate(-1))
    await tick()
    expect(resolveOlder).toBeTypeOf('function')
    await act(async () => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 200 }))
      y = 200
      window.dispatchEvent(new Event('scroll'))
    })
    await act(async () => resolveOlder(page(2)))
    await tick()
    expect(y).toBe(200)
  })

  it('keeps other stored history entries after a reload-like mount', async () => {
    const keyA = `stored-a-${++nextKey}`
    const keyB = `stored-b-${++nextKey}`
    sessionStorage.setItem('nh-discover-scroll-v1', JSON.stringify([
      [`guest:${keyA}:?type=help`, { y: 310, pages: 1 }],
      [`guest:${keyB}:?type=idle`, { y: 620, pages: 1 }],
    ]))
    await mount('/discover?type=idle', keyB, [
      { pathname: '/discover', search: '?type=help', key: keyA },
      { pathname: '/discover', search: '?type=idle', key: keyB },
    ])
    expect(y).toBe(620)
    await act(async () => router.navigate(-1))
    await tick()
    expect(y).toBe(310)
  })

  it('does not enable pagination before restoring a rapid back from an unfinished filter', async () => {
    client.setQueryData(['posts', 'help', '', undefined], { pages: [page(1, true)], pageParams: [1] })
    await mount('/discover?type=help')
    y = 640
    window.dispatchEvent(new Event('scroll'))
    let resolveIdle
    api.getPosts.mockImplementation(async (type, number) => type === 'idle'
      ? new Promise(resolve => { resolveIdle = resolve })
      : page(number, false))
    await click('闲置转让')
    await act(async () => router.navigate(-1))
    // 先模拟浏览器对旧哨兵的可见通知，再推进位置恢复帧。
    await act(async () => observers.forEach(observer => observer.enter()))
    expect(api.getPosts.mock.calls.some(([type, number]) => type === 'help' && number === 2)).toBe(false)
    await tick()
    expect(y).toBe(640)
    await act(async () => resolveIdle(page()))
  })
})
