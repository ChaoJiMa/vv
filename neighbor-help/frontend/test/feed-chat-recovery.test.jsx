import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PostFeed from '../src/components/ui/PostFeed'
import Chat from '../src/pages/Chat'
import { api } from '../src/api'
import { useChatScroll } from '../src/hooks/useChatScroll'

// 列表布局依赖真实几何；此处保留真实分页/错误状态，仅用简单节点代替瀑布排版。
vi.mock('../src/components/ui/Waterfall', () => ({
  default: ({ items, renderItem }) => <div>{items.map(item => <div key={item.id}>{renderItem(item, {})}</div>)}</div>,
}))
vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me', nickname: '我' } }) }))
vi.mock('../src/hooks/usePageVisible', () => ({ usePageVisible: () => false, pollInterval: () => false }))

/** 用假视口测行为边界，不连接后端或使用真实私信数据。 */
describe('feed and chat recover without losing existing content', () => {
  let root, container, client, observers, scrollY, scrollHeight, scrollIntoView
  const message = (id, sender = 'peer', timestamp = 1) => ({ id, sender_id: sender, content: `消息${id}`, created_at: timestamp })
  const thread = (list, extra = {}) => ({ list, page: 1, hasMore: false, peer: { id: 'peer', nickname: '邻居甲' }, postTitle: '借用工具', postId: 'post', ...extra })
  const cachedThread = list => ({ pages: [thread(list)], pageParams: [1] })

  function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  async function render(element) {
    await act(async () => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>))
    await settle()
  }
  async function settle() {
    // Query 的批量通知先提交，再等待下一帧的滚动提示状态。
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label)
    expect(button, label).toBeTruthy()
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    await settle()
  }
  async function typeMessage(value) {
    const input = container.querySelector('input[aria-label="私信内容"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  function feedHarness(fetchPage) {
    return function FeedHarness() {
      const query = useInfiniteQuery({
        queryKey: ['feed'], queryFn: ({ pageParam }) => fetchPage(pageParam),
        initialPageParam: 1, getNextPageParam: page => page.hasMore ? page.page + 1 : undefined,
      })
      return <PostFeed
        items={query.data?.pages.flatMap(page => page.list) || []}
        isLoading={query.isLoading} isError={query.isError} isFetching={query.isFetching}
        isFetchNextPageError={query.isFetchNextPageError} isRefetchError={query.isRefetchError}
        hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={query.fetchNextPage} onRetry={query.refetch}
        renderItem={item => <span>{item.title}</span>}
      />
    }
  }
  const chat = () => <MemoryRouter initialEntries={['/messages/conv']}><Routes><Route path="/messages/:conversationId" element={<Chat />} /></Routes></MemoryRouter>

  beforeEach(() => {
    observers = []
    scrollY = 0
    scrollHeight = 3000
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    vi.spyOn(window, 'scrollTo').mockImplementation(options => { scrollY = options.top })
    scrollIntoView = vi.fn(() => { scrollY = scrollHeight - window.innerHeight })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.active = true; observers.push(this) }
      observe(node) { this.node = node }
      disconnect() { this.active = false }
      enter() { if (this.active) this.callback([{ isIntersecting: true }]) }
    })
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
    delete HTMLElement.prototype.scrollIntoView
    delete window.scrollY
    delete document.documentElement.scrollHeight
  })

  it('keeps posts after a next-page failure, stops automatic retries, and retries that page explicitly', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ list: [{ id: 'a', title: '已有帖子' }], page: 1, hasMore: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ list: [{ id: 'b', title: '下一页帖子' }], page: 2, hasMore: false })
    const Feed = feedHarness(fetchPage)
    await render(<Feed />)
    await act(async () => observers.filter(observer => observer.active).forEach(observer => observer.enter()))
    await settle()
    expect(container.textContent).toContain('已有帖子')
    expect(container.textContent).toContain('重试加载更多')
    await act(async () => observers.forEach(observer => observer.enter()))
    await settle()
    expect(fetchPage).toHaveBeenCalledTimes(2)
    await click('重试加载更多')
    expect(fetchPage.mock.calls.map(call => call[0])).toEqual([1, 2, 2])
    expect(container.textContent).toContain('已有帖子')
    expect(container.textContent).toContain('下一页帖子')
    expect(container.textContent).toContain('没有更多了')
  })

  it('keeps posts during a failed refresh and retries the first page rather than fetching a new page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ list: [{ id: 'a', title: '原有帖子' }], page: 1, hasMore: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ list: [{ id: 'a', title: '刷新后的帖子' }], page: 1, hasMore: true })
    const Feed = feedHarness(fetchPage)
    await render(<Feed />)
    await act(async () => client.refetchQueries({ queryKey: ['feed'] }))
    await settle()
    expect(container.textContent).toContain('原有帖子')
    expect(container.textContent).toContain('重试刷新')
    expect(container.textContent).not.toContain('重试加载更多')
    await click('重试刷新')
    expect(fetchPage.mock.calls.map(call => call[0])).toEqual([1, 1, 1])
    expect(container.textContent).toContain('刷新后的帖子')
  })

  it('keeps loaded chat bubbles and typed input when polling fails, then recovers in place', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    const fetch = vi.spyOn(api, 'getThread').mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 500 })).mockResolvedValue(thread([message('a')]))
    await render(chat())
    const input = container.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '还没发送的内容')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await client.refetchQueries({ queryKey: ['thread', 'conv', 'me'] })
    })
    await settle()
    expect(container.textContent).toContain('消息a')
    expect(container.textContent).toContain('刷新失败')
    expect(container.textContent).not.toContain('会话无效')
    expect(container.querySelector('input').value).toBe('还没发送的内容')
    await click('重试刷新')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('刷新失败')
    expect(container.querySelector('input').value).toBe('还没发送的内容')
  })

  it('offers a retry for initial network failure and only marks business code 3002 as invalid', async () => {
    const fetch = vi.spyOn(api, 'getThread')
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(Object.assign(new Error('invalid conversation'), { code: 3002 }))
    await render(chat())
    expect(container.textContent).toContain('暂时无法加载消息')
    expect(container.textContent).not.toContain('会话无效')
    expect(container.querySelector('input')).toBeTruthy()
    await click('重试')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('会话无效或已失效')
    expect(container.querySelector('input')).toBeNull()
  })

  it('retains chat messages when older history fails and retries the failed history page explicitly', async () => {
    client.setQueryData(['thread', 'conv', 'me'], { pages: [thread([message('a')], { hasMore: true })], pageParams: [1] })
    const fetch = vi.spyOn(api, 'getThread')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(thread([message('older', 'peer', 0)], { page: 2, hasMore: false }))
    await render(chat())
    await act(async () => observers.filter(observer => observer.active).forEach(observer => observer.enter()))
    await settle()
    expect(container.textContent).toContain('消息a')
    expect(container.textContent).toContain('重试加载更早消息')
    expect(container.querySelector('input')).toBeTruthy()
    await act(async () => observers.forEach(observer => observer.enter()))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    await click('重试加载更早消息')
    expect(fetch.mock.calls.map(call => call.slice(0, 2))).toEqual([['conv', 2], ['conv', 2]])
    expect(container.textContent).toContain('消息older')
    expect(container.textContent).toContain('消息a')
    expect(container.textContent).not.toContain('重试加载更早消息')
  })

  it('does not pull a reader to the bottom for an incoming message, but follows while near the bottom', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a')]))
    await render(chat())
    scrollIntoView.mockClear()
    await act(async () => { scrollY = 500; window.dispatchEvent(new Event('scroll')) })
    await act(async () => client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a'), message('b', 'peer', 2)])))
    await settle()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(container.textContent).toContain('有新消息，点击查看')
    await click('有新消息，点击查看')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('有新消息，点击查看')
    await act(async () => window.dispatchEvent(new Event('scroll')))
    await act(async () => client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a'), message('b', 'peer', 2), message('c', 'peer', 3)])))
    await settle()
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('有新消息，点击查看')
  })

  it('follows a deliberate send even when the sender is reading older messages', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    const sending = deferred()
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a'), message('sent', 'me', Date.now())]))
    vi.spyOn(api, 'sendMessage').mockReturnValue(sending.promise)
    await render(chat())
    scrollIntoView.mockClear()
    await act(async () => { scrollY = 500; window.dispatchEvent(new Event('scroll')) })
    const input = container.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '主动发送')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('发送')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('主动发送')
    await act(async () => sending.resolve({ id: 'sent' }))
    await settle()
  })

  it('keeps incoming messages received while a failed send was pending', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    const sending = deferred()
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a'), message('incoming', 'peer', 2)]))
    vi.spyOn(api, 'sendMessage').mockReturnValue(sending.promise)
    await render(chat())
    await typeMessage('会发送失败的消息')
    await click('发送')
    await act(async () => client.refetchQueries({ queryKey: ['thread', 'conv', 'me'] }))
    await settle()
    expect(container.textContent).toContain('消息incoming')
    await act(async () => sending.reject(new Error('offline')))
    await settle()
    expect(container.textContent).toContain('消息incoming')
    expect(container.textContent).not.toContain('会发送失败的消息')
    expect(container.querySelector('input').value).toBe('会发送失败的消息')
  })

  it('preserves a newer input while retrying an earlier failed message', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    const resending = deferred()
    const send = vi.spyOn(api, 'sendMessage').mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(resending.promise)
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a')]))
    await render(chat())
    await typeMessage('先前失败的消息')
    await click('发送')
    await typeMessage('正在写的下一条消息')
    await click('发送失败，点此重送')
    expect(send.mock.calls[1][1]).toBe('先前失败的消息')
    expect(container.querySelector('input').value).toBe('正在写的下一条消息')
    await act(async () => resending.resolve({ id: 'sent' }))
    await settle()
    expect(container.querySelector('input').value).toBe('正在写的下一条消息')
  })

  it('removes only the failed optimistic bubble after older history was loaded', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    const sending = deferred()
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a')]))
    vi.spyOn(api, 'sendMessage').mockReturnValue(sending.promise)
    await render(chat())
    await typeMessage('本次临时发送')
    await click('发送')
    await act(async () => client.setQueryData(['thread', 'conv', 'me'], current => ({
      ...current,
      pages: [...current.pages, thread([message('older', 'peer', 0)], { page: 2 })],
      pageParams: [1, 2],
    })))
    await settle()
    await act(async () => sending.reject(new Error('offline')))
    await settle()
    expect(container.textContent).toContain('消息older')
    expect(container.textContent).toContain('消息a')
    expect(container.querySelector('[data-message-id^="temp-"]')).toBeNull()
    expect(container.querySelector('input').value).toBe('本次临时发送')
  })

  it('does not send while the Enter key is confirming Chinese composition', async () => {
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    const send = vi.spyOn(api, 'sendMessage').mockResolvedValue({ id: 'sent' })
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a')]))
    await render(chat())
    await typeMessage('中文输入')
    await act(async () => container.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', isComposing: true, bubbles: true,
    })))
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(container.querySelector('input').value).toBe('中文输入')
  })

  it('keeps the latest message in view when the keyboard opens without pulling a history reader', async () => {
    const viewport = new EventTarget()
    viewport.height = 600
    viewport.offsetTop = 0
    vi.stubGlobal('visualViewport', viewport)
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a')]))
    await render(chat())
    scrollIntoView.mockClear()
    await act(async () => {
      viewport.height = 350
      scrollHeight = 3250
      viewport.dispatchEvent(new Event('resize'))
    })
    await settle()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })
    scrollIntoView.mockClear()
    await act(async () => {
      scrollY = 500
      window.dispatchEvent(new Event('scroll'))
      viewport.height = 600
      scrollHeight = 3000
      viewport.dispatchEvent(new Event('resize'))
    })
    await settle()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollY).toBe(500)
  })

  it('uses an immediate jump when reduced motion is preferred', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a')]))
    vi.spyOn(api, 'getThread').mockResolvedValue(thread([message('a')]))
    await render(chat())
    scrollIntoView.mockClear()
    await act(async () => { scrollY = 500; window.dispatchEvent(new Event('scroll')) })
    await act(async () => client.setQueryData(['thread', 'conv', 'me'], cachedThread([message('a'), message('new', 'peer', 2)])))
    await settle()
    await click('有新消息，点击查看')
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' })
  })

  it('preserves a visible bubble after prepending history, including scrolling while the request is pending', async () => {
    let view, controls
    const history = deferred()
    const fetchNextPage = vi.fn(() => history.promise)
    function ScrollHarness() {
      controls = useChatScroll({ messages: view.messages, pageCount: view.pages, userId: 'me', fetchNextPage })
      return <div ref={controls.listRef}>{view.messages.map(m => <div key={m.id} data-message-id={m.id}>{m.content}</div>)}<div ref={controls.bottomRef} /></div>
    }
    view = { messages: [message('a'), message('b', 'peer', 2)], pages: 1 }
    await render(<ScrollHarness />)
    const bubble = container.querySelector('[data-message-id="a"]')
    let bubbleTop = 50
    vi.spyOn(bubble, 'getBoundingClientRect').mockImplementation(() => ({ top: bubbleTop, bottom: bubbleTop + 40 }))
    await act(async () => { scrollY = 500; window.dispatchEvent(new Event('scroll')); controls.loadOlder() })
    // 请求期间用户又向下滚了 100px；历史插入新增 300px，气泡最终从 50px 移到 250px。
    scrollY = 600
    bubbleTop = 250
    scrollHeight = 3300
    view = { messages: [message('older', 'peer', 0), ...view.messages], pages: 2 }
    await act(async () => { root.render(<QueryClientProvider client={client}><ScrollHarness /></QueryClientProvider>); history.resolve({ isError: false }) })
    await settle()
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: 'auto' })
    expect(container.textContent).not.toContain('有新消息')
  })
})
