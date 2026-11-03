import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Messages from '../src/pages/Messages'
import PostDetail from '../src/pages/PostDetail'
import { api } from '../src/api'
import { MockAuthProvider } from '../src/hooks/useAuth'

const auth = vi.hoisted(() => ({ user: { id: 'me', nickname: '测试用户' } }))
vi.mock('../src/components/BottomNav', () => ({ default: () => null }))
vi.mock('../src/hooks/useAuth', async () => {
  const { createContext, useContext } = await import('react')
  const context = createContext(null)
  return { MockAuthProvider: context.Provider, useAuth: () => useContext(context) }
})
vi.mock('../src/hooks/usePageVisible', () => ({ usePageVisible: () => false, pollInterval: () => false }))

/** 对消息列表/详情使用真实 Query，自动可见哨兵用于暴露失败后重挂导致的请求循环。 */
describe('message lists and post comments recover by failed page', () => {
  let root, container, client, router
  const conversation = id => ({ conversationId: id, peerName: `测试邻居${id}`, postTitle: '借用工具', content: '你好', createdAt: 1 })
  const notice = id => ({ notificationId: id, actorName: `测试邻居${id}`, postId: 'post', postTitle: '借用工具', notiType: 'comment', content: '留言', read: true, createdAt: 1 })
  const comment = id => ({ id, user_id: 'peer', nickname: `测试评论${id}`, content: '已有评论内容', created_at: 1 })
  const page = (list, number = 1, hasMore = true) => ({ list, page: number, hasMore, total: 2 })
  const cache = first => ({ pages: [first], pageParams: [1] })
  const post = { id: 'post', user_id: 'peer', type: 'help', title: '需要保留的帖子标题', content: '已有帖子正文', status: 'open', images: [], stats: { commentCount: 2 } }
  async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  }
  async function mount(kind) {
    const path = kind === 'messages' ? '/messages' : '/note/post'
    router ??= createMemoryRouter([
      { path: '/messages', element: <Messages /> },
      { path: '/note/:id', element: <PostDetail /> },
    ], { initialEntries: [path] })
    await act(async () => root.render(
      <QueryClientProvider client={client}><MockAuthProvider value={{ user: auth.user }}><RouterProvider router={router} /></MockAuthProvider></QueryClientProvider>
    ))
    await settle()
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label || el.getAttribute('aria-label') === label)
    expect(button, label).toBeTruthy()
    await act(async () => button.click())
    await settle()
  }
  async function typeComment(value) {
    const input = container.querySelector('input[placeholder="说点什么…"], input[placeholder^="回复 @"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  // 旧逻辑自动重复失败时最多发到第 4 次后挂起，避免错误实现把回归测试拖成无限循环。
  function failThenHang(spy) {
    let calls = 0
    spy.mockImplementation(() => ++calls <= 3 ? Promise.reject(new Error('offline')) : new Promise(() => {}))
  }
  beforeEach(() => {
    router = undefined
    auth.user = { id: 'me', nickname: '测试用户' }
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.active = true }
      observe() { setTimeout(() => { if (this.active) this.callback([{ isIntersecting: true }]) }, 0) }
      disconnect() { this.active = false }
    })
    vi.spyOn(api, 'getUnread').mockResolvedValue({ total: 0, messageUnread: 0, notiUnread: 0 })
    vi.spyOn(api, 'getConversations').mockResolvedValue(page([], 1, false))
    vi.spyOn(api, 'getNotifications').mockResolvedValue(page([], 1, false))
    vi.spyOn(api, 'getPost').mockResolvedValue(post)
    vi.spyOn(api, 'getComments').mockResolvedValue(page([], 1, false))
    vi.spyOn(api, 'addComment').mockResolvedValue({ id: 'new-comment' })
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

  it.each(['conversations', 'notifications'])('pauses failed %s pagination and retries the failed page', async kind => {
    const notifications = kind === 'notifications'
    const key = [kind, 'me']
    const item = notifications ? notice : conversation
    client.setQueryData(key, cache(page([item('a')])))
    const fetch = notifications ? api.getNotifications : api.getConversations
    failThenHang(fetch)
    await mount('messages')
    if (notifications) await click('通知')
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('测试邻居a')
    expect(container.textContent).toContain('加载更多失败，已有内容已保留')
    fetch.mockResolvedValueOnce(page([item('b')], 2, false))
    await click('重试加载更多')
    expect(fetch).toHaveBeenLastCalledWith(2)
    expect(container.textContent).toContain('测试邻居b')
  })

  it('keeps the message list when background refresh fails', async () => {
    client.setQueryData(['conversations', 'me'], cache(page([conversation('a')], 1, false)))
    api.getConversations.mockRejectedValueOnce(new Error('offline'))
    await mount('messages')
    await act(async () => client.invalidateQueries({ queryKey: ['conversations', 'me'] }))
    await settle()
    expect(container.textContent).toContain('测试邻居a')
    expect(container.textContent).toContain('刷新失败，已保留当前内容')
  })

  it('keeps the post and existing comments while retrying a failed comment page', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([comment('a')])))
    failThenHang(api.getComments)
    await mount('post')
    await settle()
    expect(api.getComments).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(post.title)
    expect(container.textContent).toContain('已有评论内容')
    expect(container.textContent).toContain('更多评论加载失败')
    api.getComments.mockResolvedValueOnce(page([comment('b')], 2, false))
    await click('重试加载评论')
    expect(api.getComments).toHaveBeenLastCalledWith('post', 2)
    expect(container.textContent).toContain('测试评论b')
  })

  it('keeps the post and composing input on transient background detail failure', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([], 1, false)))
    await mount('post')
    api.getPost.mockRejectedValueOnce(new Error('offline'))
    await act(async () => client.invalidateQueries({ queryKey: ['post', 'post', 'me'] }))
    await settle()
    expect(container.textContent).toContain(post.title)
    expect(container.querySelector('input[placeholder="说点什么…"]')).toBeTruthy()
    expect(container.textContent).toContain('刷新失败，已保留当前帖子')
  })

  it('still hides stale details when the backend confirms the post is gone', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([], 1, false)))
    await mount('post')
    api.getPost.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 2001 }))
    await act(async () => client.invalidateQueries({ queryKey: ['post', 'post', 'me'] }))
    await settle()
    expect(container.textContent).not.toContain(post.title)
    expect(container.querySelector('input')).toBeNull()
  })

  it('does not submit a comment while Enter is confirming an IME candidate', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([], 1, false)))
    await mount('post')
    const input = container.querySelector('input[placeholder="说点什么…"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '尚未完成的中文')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
    expect(api.addComment).not.toHaveBeenCalled()
    expect(input.value).toBe('尚未完成的中文')
  })

  it('retries the first expanded reply page after its request fails', async () => {
    const first = { ...comment('a'), replies: { list: [{ id: 'r1', nickname: '邻居甲', content: '已有二级回复' }], total: 2, hasMore: true } }
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([first], 1, false)))
    const fetch = vi.spyOn(api, 'getCommentReplies')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([first.replies.list[0], { id: 'r2', nickname: '邻居乙', content: '恢复后的二级回复' }], 1, false))
    await mount('post')
    await click('还有 1 条回复')
    expect(container.textContent).toContain('已有二级回复')
    await click('还有 1 条回复')
    expect(fetch.mock.calls).toEqual([['a', 1], ['a', 1]])
    expect(container.textContent).toContain('恢复后的二级回复')
  })

  it('keeps a newer comment input after the previous send succeeds', async () => {
    let resolveSend
    api.addComment.mockReturnValueOnce(new Promise(resolve => { resolveSend = resolve }))
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([], 1, false)))
    await mount('post')
    await typeComment('第一条评论')
    await click('发送')
    await typeComment('发送期间写的第二条评论')
    await act(async () => resolveSend({ id: 'sent' }))
    await settle()
    expect(container.querySelector('input').value).toBe('发送期间写的第二条评论')
  })

  it('clears an unchanged comment after successful submission', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([], 1, false)))
    await mount('post')
    await typeComment('已提交评论')
    await click('发送')
    expect(container.querySelector('input').value).toBe('')
  })

  it('starts with an empty composer when the signed-in account changes', async () => {
    let resolveSend
    api.addComment.mockReturnValueOnce(new Promise(resolve => { resolveSend = resolve }))
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([], 1, false)))
    await mount('post')
    await typeComment('上个账号的未发送评论')
    await click('发送')
    auth.user = { id: 'other', nickname: '另一位测试用户' }
    client.setQueryData(['post', 'post', 'other'], post)
    await mount('post')
    expect(container.querySelector('input').value).toBe('')
    await typeComment('新账号的独立评论')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await act(async () => resolveSend({ id: 'old-account-comment' }))
    await settle()
    expect(container.querySelector('input').value).toBe('新账号的独立评论')
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('retains loaded comment pages when the post detail refreshes', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], {
      pages: [page([comment('a')]), page([comment('b')], 2, false)], pageParams: [1, 2],
    })
    await mount('post')
    api.getPost.mockResolvedValue({ ...post, comments: page([comment('a')]) })
    api.getComments.mockImplementation((_id, number) => Promise.resolve(page([comment(number === 1 ? 'a' : 'b')], number, number === 1)))
    await act(async () => client.refetchQueries({ queryKey: ['post', 'post', 'me'] }))
    await settle()
    expect(container.textContent).toContain('测试评论b')
    expect(client.getQueryData(['comments', 'post']).pageParams).toEqual([1, 2])
    await click('刷新')
    expect(api.getComments.mock.calls).toEqual([['post', 1], ['post', 2]])
    expect(container.textContent).toContain('测试评论b')
    expect(client.getQueryData(['comments', 'post']).pageParams).toEqual([1, 2])
  })

  it('does not carry a reply target or input from one post into another', async () => {
    client.setQueryData(['post', 'post', 'me'], post)
    client.setQueryData(['comments', 'post'], cache(page([comment('a')], 1, false)))
    client.setQueryData(['post', 'second', 'me'], { ...post, id: 'second', title: '另一条帖子' })
    client.setQueryData(['comments', 'second'], cache(page([], 1, false)))
    const reply = vi.spyOn(api, 'addCommentReply').mockResolvedValue({ id: 'reply' })
    await mount('post')
    await click('回复')
    await typeComment('原帖还没发送的回复')
    await act(async () => router.navigate('/note/second'))
    await settle()
    expect(container.querySelector('input').placeholder).toBe('说点什么…')
    expect(container.querySelector('input').value).toBe('')
    await typeComment('新帖独立评论')
    await click('发送')
    expect(api.addComment).toHaveBeenCalledWith('second', '新帖独立评论')
    expect(reply).not.toHaveBeenCalled()
  })
})
