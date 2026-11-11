import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Messages from '../src/pages/Messages'
import { api } from '../src/api'

vi.mock('../src/components/BottomNav', () => ({ default: () => null }))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../src/hooks/usePageVisible', () => ({ usePageVisible: () => false, pollInterval: () => false }))

/** 使用真实 Query 分页与本地筛选，验证搜索不会冒充服务端查询或锁死后续页。 */
describe('消息当前列表筛选', () => {
  let root, container, client, observers
  const page = (list, number = 1, hasMore = false) => ({ list, page: number, hasMore })
  const cache = first => ({ pages: [first], pageParams: [1] })
  const conversation = (id, fields = {}) => ({ conversationId: id, peerName: `邻居${id}`, postTitle: '借用工具', content: '你好', createdAt: 1, ...fields })
  const notice = (id, fields = {}) => ({ notificationId: id, actorName: `邻居${id}`, postTitle: '借用工具', content: '留言', notiType: 'comment', read: true, createdAt: 1, ...fields })

  function deferred() {
    let resolve
    const promise = new Promise(yes => { resolve = yes })
    return { promise, resolve }
  }

  async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  }
  async function mount() {
    await act(async () => root.render(
      <MemoryRouter><QueryClientProvider client={client}><Messages /></QueryClientProvider></MemoryRouter>
    ))
    await settle()
  }
  async function search(value) {
    const input = container.querySelector('input[aria-label="搜索当前列表"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label)
    expect(button, label).toBeTruthy()
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    await settle()
  }
  const cards = () => [...container.querySelectorAll('.nh-conversation-card')]

  beforeEach(() => {
    observers = []
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.active = true; observers.push(this) }
      observe() {}
      disconnect() { this.active = false }
      enter() { if (this.active) this.callback([{ isIntersecting: true }]) }
    })
    vi.spyOn(api, 'getUnread').mockResolvedValue({ messageUnread: 0, notiUnread: 0 })
    vi.spyOn(api, 'getConversations').mockResolvedValue(page([]))
    vi.spyOn(api, 'getNotifications').mockResolvedValue(page([]))
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(['conversations', 'me'], cache(page([])))
    client.setQueryData(['notifications', 'me'], cache(page([])))
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

  it('刷新仅作用于当前分类，等待时保留列表并禁用重复点击，切换分类不混用刷新状态', async () => {
    const existingConversation = conversation('a', { peerName: '保留的会话' })
    const existingNotice = notice('a', { actorName: '保留的通知' })
    client.setQueryData(['conversations', 'me'], cache(page([existingConversation])))
    client.setQueryData(['notifications', 'me'], cache(page([existingNotice])))
    const conversations = deferred()
    const notifications = deferred()
    api.getConversations.mockReturnValueOnce(conversations.promise)
    api.getNotifications.mockReturnValueOnce(notifications.promise)
    await mount()
    const refresh = () => container.querySelector('button[aria-label="刷新"]')
    const expectWaiting = () => {
      expect(refresh().disabled).toBe(true)
      expect(refresh().getAttribute('aria-busy')).toBe('true')
      expect(refresh().querySelector('svg.nh-spin')).toBeTruthy()
    }
    const expectReady = () => {
      expect(refresh().disabled).toBe(false)
      expect(refresh().getAttribute('aria-busy')).not.toBe('true')
      expect(refresh().querySelector('svg.nh-spin')).toBeNull()
    }

    expectReady()
    await click('刷新')
    expectWaiting()
    expect(cards()[0].textContent).toContain('保留的会话')
    expect(api.getConversations).toHaveBeenCalledExactlyOnceWith(1)
    expect(api.getNotifications).not.toHaveBeenCalled()
    await act(async () => refresh().click())
    expect(api.getConversations).toHaveBeenCalledTimes(1)

    // 私信仍在等待时切换通知，按钮必须跟随当前 Query，不能沿用后台私信的忙碌状态。
    await click('通知')
    expectReady()
    expect(cards()[0].textContent).toContain('保留的通知')
    await click('刷新')
    expectWaiting()
    expect(cards()[0].textContent).toContain('保留的通知')
    expect(api.getNotifications).toHaveBeenCalledExactlyOnceWith(1)
    expect(api.getConversations).toHaveBeenCalledTimes(1)
    await act(async () => refresh().click())
    expect(api.getNotifications).toHaveBeenCalledTimes(1)
    await act(async () => notifications.resolve(page([existingNotice, notice('b', { actorName: '新增通知' })])))
    await settle()
    expectReady()
    expect(container.textContent).toContain('保留的通知')
    expect(container.textContent).toContain('新增通知')

    await click('私信')
    expectWaiting()
    expect(cards()[0].textContent).toContain('保留的会话')
    await act(async () => conversations.resolve(page([existingConversation, conversation('b', { peerName: '新增会话' })])))
    await settle()
    expectReady()
    expect(container.textContent).toContain('保留的会话')
    expect(container.textContent).toContain('新增会话')
    expect(api.getConversations).toHaveBeenCalledTimes(1)
    expect(api.getNotifications).toHaveBeenCalledTimes(1)
  })

  it('按当前会话的昵称、帖子和预览筛选，清空恢复原列表且不发送搜索请求', async () => {
    client.setQueryData(['conversations', 'me'], cache(page([
      conversation('a', { peerName: '小林' }),
      conversation('b', { postTitle: '台灯转让' }),
      conversation('c', { content: 'HELLO 邻居' }),
    ])))
    await mount()
    await search('小林')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('小林')
    await search('台灯')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('台灯转让')
    await search('hello')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('HELLO')
    await click('清空搜索')
    expect(cards()).toHaveLength(3)
    expect(container.querySelector('input').value).toBe('')
    expect(document.activeElement).toBe(container.querySelector('input'))
    expect(api.getConversations).not.toHaveBeenCalled()
  })

  it('清空筛选后恢复当前列表的自动分页', async () => {
    client.setQueryData(['conversations', 'me'], cache(page([conversation('a', { peerName: '阿林' })], 1, true)))
    api.getConversations.mockResolvedValueOnce(page([conversation('b')], 2, false))
    await mount()
    await search('阿林')
    await act(async () => observers.forEach(observer => observer.enter()))
    await settle()
    expect(api.getConversations).not.toHaveBeenCalled()
    await click('清空搜索')
    await act(async () => observers.forEach(observer => observer.enter()))
    await settle()
    expect(api.getConversations).toHaveBeenCalledExactlyOnceWith(2)
    expect(cards()).toHaveLength(2)
  })

  it('无匹配时暂停自动翻页，仍可明确加载下一页并在同一关键词下显示结果', async () => {
    client.setQueryData(['conversations', 'me'], cache(page([conversation('a')], 1, true)))
    api.getConversations.mockResolvedValueOnce(page([conversation('b', { peerName: '目标邻居' })], 2, false))
    await mount()
    await search('目标')
    expect(cards()).toHaveLength(0)
    expect(container.textContent).toContain('当前列表暂无匹配')
    await act(async () => observers.forEach(observer => observer.enter()))
    await settle()
    expect(api.getConversations).not.toHaveBeenCalled()
    await click('加载更多后继续查找')
    expect(api.getConversations).toHaveBeenCalledExactlyOnceWith(2)
    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('目标邻居')
    expect(container.querySelector('input').value).toBe('目标')
    await click('清空搜索')
    expect(cards()).toHaveLength(2)
  })

  it('通知支持同样的本地筛选，并保留手动加载失败后的原页重试', async () => {
    client.setQueryData(['notifications', 'me'], cache(page([notice('a', { actorName: '阿林' })], 1, true)))
    api.getNotifications
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([notice('b', { content: '目标回复' })], 2, false))
    await mount()
    await click('通知')
    await search('阿林')
    expect(cards()).toHaveLength(1)
    await search('目标')
    expect(cards()).toHaveLength(0)
    await click('加载更多后继续查找')
    expect(container.textContent).toContain('加载更多失败，已有内容已保留')
    await act(async () => observers.forEach(observer => observer.enter()))
    await settle()
    expect(api.getNotifications).toHaveBeenCalledTimes(1)
    await click('重试加载更多')
    expect(api.getNotifications).toHaveBeenCalledTimes(2)
    expect(api.getNotifications).toHaveBeenLastCalledWith(2)
    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('目标回复')
    expect(container.querySelector('input').value).toBe('目标')
  })
})
