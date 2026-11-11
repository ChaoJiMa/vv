import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../src/pages/Profile'
import { api } from '../src/api'

vi.mock('../src/components/BottomNav', () => ({ default: () => null }))
vi.mock('../src/components/BottomSheet', () => ({ default: () => null }))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'profile-user', nickname: '测试用户' } }) }))
vi.mock('../src/theme/useAppTheme', () => ({ useAppTheme: () => ({ mode: 'light', setMode: () => {} }) }))

/** 使用真实查询占位数据，区分旧状态的空列表与新状态尚未完成的请求。 */
describe('profile status filter recovery', () => {
  let root, container, client
  const page = list => ({ list, page: 1, hasMore: false })
  const post = { id: 'profile-post', user_id: 'profile-user', type: 'help', title: '旧状态里的帖子', content: '测试正文', images: [], status: 'open' }
  async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  }
  async function mount(list) {
    client.setQueryData(['myPosts', '', 'profile-user'], { pages: [page(list)], pageParams: [1] })
    await act(async () => root.render(
      <QueryClientProvider client={client}><MemoryRouter><Profile /></MemoryRouter></QueryClientProvider>
    ))
    await settle()
  }
  async function select(label) {
    const tab = [...container.querySelectorAll('[role="tab"]')].find(element => element.textContent === label)
    await act(async () => tab.click())
    await settle()
  }
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    vi.spyOn(api, 'getMenus').mockResolvedValue([])
    vi.spyOn(api, 'getMyStats').mockResolvedValue({ helped: 0, received: 0 })
    vi.spyOn(api, 'getMyPosts').mockResolvedValue(page([]))
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('waits for the requested status before displaying its empty state', async () => {
    await mount([])
    let resolve
    api.getMyPosts.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
    await select('进行中')
    expect(container.textContent).not.toContain('没有进行中的帖子')
    expect(container.querySelector('.nh-skeleton')).toBeTruthy()
    expect(container.querySelector('[role="status"]').textContent).toContain('正在更新')
    await act(async () => resolve(page([])))
    await settle()
    expect(container.textContent).toContain('没有进行中的帖子')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('identifies the retained list while a different status is still loading', async () => {
    await mount([post])
    let resolve
    api.getMyPosts.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
    await select('已完成')
    expect(container.textContent).toContain(post.title)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在更新')
    await act(async () => resolve(page([])))
    await settle()
    expect(container.textContent).not.toContain(post.title)
    expect(container.textContent).toContain('没有已完成的帖子')
  })
})
