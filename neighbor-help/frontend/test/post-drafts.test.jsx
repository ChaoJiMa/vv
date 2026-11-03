import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import { toast } from '../src/toast'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { postDraftKey, readPostDraft } from '../src/hooks/usePostDraft'
import CreatePost from '../src/pages/CreatePost'
import { downscaleImage } from '../src/utils/image'

vi.mock('../src/components/BottomNav', () => ({
  default: function TestNavigation() {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate('/discover')}>发现入口</button>
  },
}))
vi.mock('../src/utils/image', async importOriginal => ({
  ...await importOriginal(),
  downscaleImage: vi.fn(async file => ({ file, width: 100, height: 80 })),
}))

/** 使用真实 data router 验证离开/返回与持久化，避免只测试与实现相同的布尔判断。 */
describe('post drafts and navigation protection', () => {
  const alice = { id: 'alice', nickname: 'Alice', building: '1', unit: '101' }
  const bob = { id: 'bob', nickname: 'Bob', building: '2', unit: '202' }
  const original = {
    id: 'post-1', type: 'help', status: 'open', title: '原始标题', content: '原始描述', contact: '',
    location: '小区门口', images: ['original.jpg'],
  }
  let root, container, client, router, auth, historyState
  function Probe() { auth = useAuth(); return null }

  async function mount(entry = { pathname: '/create', state: { type: 'help' } }, strict = false) {
    router = createMemoryRouter([
      { path: '/', element: <p>首页目的地</p> },
      { path: '/discover', element: <p>发现目的地</p> },
      { path: '/create', element: <CreatePost /> },
      { path: '/edit/:id', element: <CreatePost /> },
      { path: '/note/:id', element: <p>帖子目的地</p> },
    ], { initialEntries: ['/', entry] })
    const app = (
      <QueryClientProvider client={client}>
        <AuthProvider><Probe /><RouterProvider router={router} /></AuthProvider>
      </QueryClientProvider>
    )
    await act(async () => root.render(strict ? <StrictMode>{app}</StrictMode> : app))
    // React Query 在微任务后通知订阅者，等到编辑页已取得原帖再操作。
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }

  async function click(label) {
    const button = [...document.body.querySelectorAll('button')].find(el => (
      el.textContent.trim() === label || el.getAttribute('aria-label') === label
    ))
    expect(button, `button ${label}`).toBeTruthy()
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
  }
  async function fill(selector, value) {
    const input = container.querySelector(selector)
    expect(input, selector).toBeTruthy()
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function navigate(to, options) { await act(async () => { await router.navigate(to, options) }) }
  async function pick(files) {
    const input = container.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }
  const photo = name => new File([name], `${name}.jpg`, { type: 'image/jpeg' })
  function beforeUnload() {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    historyState = window.history.state
    localStorage.setItem('token', 'alice-token')
    vi.spyOn(api, 'getMe').mockResolvedValue(alice)
    vi.spyOn(api, 'getMenus').mockResolvedValue([
      { value: 'help', label: '求助互助' }, { value: 'idle', label: '闲置转让' },
    ])
    vi.spyOn(api, 'getPost').mockResolvedValue(original)
    vi.spyOn(api, 'createPost').mockResolvedValue({ id: 'created-post' })
    vi.spyOn(api, 'updatePost').mockResolvedValue({ id: 'post-1' })
    vi.spyOn(api, 'uploadImage').mockResolvedValue({ key: 'fresh-image.jpg', width: 100, height: 80 })
    downscaleImage.mockReset().mockImplementation(async file => ({ file, width: 100, height: 80 }))
    vi.spyOn(toast, 'error').mockImplementation(() => {})
    vi.spyOn(toast, 'success').mockImplementation(() => {})
    vi.spyOn(toast, 'info').mockImplementation(() => {})
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
    window.history.replaceState(historyState, '')
  })

  it('does not guard initialization or category-only selection', async () => {
    await mount()
    await navigate('/create', { state: { type: 'idle' } })
    expect(container.querySelector('input[placeholder="输入物品名称"]')).toBeTruthy()
    expect(beforeUnload().defaultPrevented).toBe(false)
    await click('发现入口')
    expect(router.state.location.pathname).toBe('/discover')
    expect(sessionStorage.getItem(postDraftKey(alice.id))).toBeNull()
  })

  it('publishes only the building as the default location and preserves an explicitly edited location', async () => {
    await mount()
    await click('更多选项')
    expect(container.querySelector('input[placeholder="如 3 栋 2 单元"]').value).toBe('1栋')
    await fill('input[placeholder="输入你的需求标题"]', '借梯子')
    await fill('textarea', '周末借用')
    await click('发布')
    expect(api.createPost).toHaveBeenCalledWith(expect.objectContaining({ location: '1栋' }))

    api.getPost.mockResolvedValueOnce({ ...original, location: '1栋101号（手动填写）' })
    await navigate('/edit/post-1')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await click('更多选项')
    expect(container.querySelector('input[placeholder="如 3 栋 2 单元"]').value).toBe('1栋101号（手动填写）')
    await fill('input[placeholder="输入你的需求标题"]', '调整借用时间')
    await click('保存')
    expect(api.updatePost).toHaveBeenCalledWith('post-1', expect.objectContaining({ location: '1栋101号（手动填写）' }))
  })

  it('blocks bottom navigation, allows staying, and restores a kept draft after returning', async () => {
    await mount()
    await fill('input[placeholder="输入你的需求标题"]', '需要借梯子')
    await fill('textarea', '周六使用，使用后归还')
    expect(beforeUnload().defaultPrevented).toBe(true)
    await click('发现入口')
    expect(router.state.location.pathname).toBe('/create')
    expect(document.body.textContent).toContain('离开发帖？')
    await click('继续编辑')
    expect(router.state.location.pathname).toBe('/create')
    await click('发现入口')
    await click('保留文字草稿并离开')
    expect(router.state.location.pathname).toBe('/discover')
    await navigate('/create')
    expect(container.querySelector('input[placeholder="输入你的需求标题"]').value).toBe('需要借梯子')
    expect(container.querySelector('textarea').value).toBe('周六使用，使用后归还')
    expect(container.textContent).toContain('已恢复当前标签页')
  })

  it('clears an explicitly discarded draft and returns with a clean form', async () => {
    await mount()
    await fill('textarea', '尚未发布的内容')
    await click('取消')
    await click('放弃修改并离开')
    expect(router.state.location.pathname).toBe('/')
    expect(sessionStorage.getItem(postDraftKey(alice.id))).toBeNull()
    await navigate('/create', { state: { type: 'help' } })
    expect(container.querySelector('textarea').value).toBe('')
  })

  it('does not mistake edit hydration for changes, and protects edited text on browser Back', async () => {
    await mount('/edit/post-1')
    expect(container.querySelector('textarea').value).toBe('原始描述')
    expect(beforeUnload().defaultPrevented).toBe(false)
    await fill('textarea', '修改后的描述')
    await navigate(-1)
    expect(router.state.location.pathname).toBe('/edit/post-1')
    expect(document.body.textContent).toContain('离开编辑？')
    await click('保留文字草稿并离开')
    expect(router.state.location.pathname).toBe('/')
    await navigate('/edit/post-1')
    expect(container.querySelector('textarea').value).toBe('修改后的描述')
    expect(container.querySelectorAll('button[aria-label="删除图片"]')).toHaveLength(1)
  })

  it.each(['new', 'edit'])('clears a %s draft after successful submission without blocking its redirect', async mode => {
    await mount(mode === 'new' ? { pathname: '/create', state: { type: 'help' } } : '/edit/post-1')
    await fill('input[placeholder="输入你的需求标题"]', '更新标题')
    await fill('textarea', '填写完整描述')
    await click(mode === 'new' ? '发布' : '保存')
    expect(router.state.location.pathname).toBe(mode === 'new' ? '/note/created-post' : '/note/post-1')
    expect(sessionStorage.getItem(postDraftKey(alice.id, mode === 'edit' ? 'post-1' : undefined))).toBeNull()
    expect(beforeUnload().defaultPrevented).toBe(false)
  })

  it('retains the form and draft when submission fails', async () => {
    api.createPost.mockRejectedValueOnce(new Error('网络暂时不可用'))
    await mount()
    await fill('input[placeholder="输入你的需求标题"]', '重试发布')
    await fill('textarea', '请求失败时也要保留')
    await click('发布')
    expect(router.state.location.pathname).toBe('/create')
    expect(container.querySelector('textarea').value).toBe('请求失败时也要保留')
    expect(readPostDraft(postDraftKey(alice.id)).fields.content).toBe('请求失败时也要保留')
  })

  it('finishes a submission even when the user attempted to leave while it was pending', async () => {
    let resolve
    api.createPost.mockReturnValueOnce(new Promise(done => { resolve = done }))
    await mount()
    await fill('input[placeholder="输入你的需求标题"]', '正在发布的标题')
    await fill('textarea', '正在发布的内容')
    await click('发布')
    await click('发现入口')
    expect(router.state.location.pathname).toBe('/create')
    const leaveButton = [...document.body.querySelectorAll('button')].find(button => button.textContent === '放弃修改并离开')
    expect(leaveButton.disabled).toBe(true)
    await act(async () => resolve({ id: 'created-post' }))
    expect(router.state.location.pathname).toBe('/note/created-post')
    expect(sessionStorage.getItem(postDraftKey(alice.id))).toBeNull()
  })

  it('keeps each account and editing target isolated', async () => {
    await mount()
    await fill('textarea', 'Alice 的文字')
    await act(async () => auth.login('bob-token', bob))
    expect(container.querySelector('textarea').value).toBe('')
    expect(sessionStorage.getItem(postDraftKey(bob.id))).toBeNull()
    await fill('textarea', 'Bob 的文字')
    expect(readPostDraft(postDraftKey(alice.id)).fields.content).toBe('Alice 的文字')
    expect(readPostDraft(postDraftKey(bob.id)).fields.content).toBe('Bob 的文字')
    await act(async () => auth.login('alice-token', alice))
    expect(container.querySelector('textarea').value).toBe('Alice 的文字')
    await click('发现入口')
    await click('保留文字草稿并离开')
    await navigate('/edit/post-1')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('textarea').value).toBe('原始描述')
  })

  it('stores no upload keys and requests reselecting image changes after restoration', async () => {
    await mount()
    await fill('textarea', '带图片的草稿')
    const input = container.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(container.querySelectorAll('button[aria-label="删除图片"]')).toHaveLength(1)
    expect(sessionStorage.getItem(postDraftKey(alice.id))).not.toContain('fresh-image.jpg')
    await click('发现入口')
    await click('保留文字草稿并离开')
    await navigate('/create')
    expect(container.querySelectorAll('button[aria-label="删除图片"]')).toHaveLength(0)
    expect(container.textContent).toContain('图片改动请重新选择')
  })

  it('rejects expired and malformed stored drafts', () => {
    const key = postDraftKey(alice.id)
    sessionStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now() - 25 * 60 * 60 * 1000, fields: {
      type: 'help', title: '过期标题', content: '过期内容', contact: '', postLocation: '',
    } }))
    expect(readPostDraft(key)).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
    sessionStorage.setItem(key, '{broken')
    expect(readPostDraft(key)).toBeNull()
  })

  it('blocks keeping-and-leaving when browser storage cannot save the draft', async () => {
    await mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota unavailable') })
    await fill('textarea', '存储不可用时继续编辑')
    await click('发现入口')
    await click('保留文字草稿并离开')
    expect(router.state.location.pathname).toBe('/create')
    expect(beforeUnload().defaultPrevented).toBe(true)
    expect(toast.info).toHaveBeenCalledWith('草稿暂时无法保存，离开前请先复制文字内容')
  })

  it('returns to the original source after cancelling edit without duplicating detail history', async () => {
    await mount('/note/post-1')
    await navigate('/edit/post-1')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await click('取消')
    expect(router.state.location.pathname).toBe('/note/post-1')
    await navigate(-1)
    expect(router.state.location.pathname).toBe('/')
  })

  it('uses the post detail when a directly opened edit page has no application history', async () => {
    window.history.replaceState({ idx: 0 }, '')
    await mount('/edit/post-1')
    await click('取消')
    expect(router.state.location.pathname).toBe('/note/post-1')
  })

  it('keeps the saved category when a refresh restores older navigation state', async () => {
    await mount()
    const category = [...container.querySelectorAll('button')].find(button => button.textContent.includes('更换'))
    await act(async () => category.click())
    await click('闲置转让')
    await fill('textarea', '闲置物品描述')
    await act(async () => root.unmount())
    router.dispose()
    root = createRoot(container)
    await mount({ pathname: '/create', state: { type: 'help' } })
    expect(container.querySelector('input[placeholder="输入物品名称"]')).toBeTruthy()
    expect(container.querySelector('textarea').value).toBe('闲置物品描述')
  })

  it('honours an explicitly selected category on a new publishing entry', async () => {
    await mount()
    await fill('textarea', '跨入口保留的文字')
    await click('发现入口')
    await click('保留文字草稿并离开')
    await navigate('/create', { state: { type: 'idle' } })
    expect(container.querySelector('input[placeholder="输入物品名称"]')).toBeTruthy()
    expect(container.querySelector('textarea').value).toBe('跨入口保留的文字')
  })

  it('restores and protects text during StrictMode effect replay', async () => {
    const key = postDraftKey(alice.id)
    sessionStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), fields: {
      type: 'idle', title: '严格模式草稿', content: '不要在双挂载期间删除', contact: '', postLocation: '',
    } }))
    await mount('/create', true)
    expect(container.querySelector('textarea').value).toBe('不要在双挂载期间删除')
    expect(readPostDraft(key).fields.content).toBe('不要在双挂载期间删除')
    await click('发现入口')
    expect(document.body.textContent).toContain('离开发帖？')
  })

  it('stops a queued upload batch after keeping a text draft and leaving', async () => {
    let resolveUpload
    api.uploadImage.mockReturnValueOnce(new Promise(resolve => { resolveUpload = resolve }))
    await mount()
    await pick([photo('first'), photo('second')])
    expect(api.uploadImage).toHaveBeenCalledTimes(1)
    await click('发现入口')
    await click('保留文字草稿并离开')
    await act(async () => resolveUpload({ key: 'first.jpg' }))
    expect(router.state.location.pathname).toBe('/discover')
    expect(api.uploadImage).toHaveBeenCalledTimes(1)
  })

  it('does not begin an upload after compression finishes on an editor that was left', async () => {
    let resolveCompression
    downscaleImage.mockReturnValueOnce(new Promise(resolve => { resolveCompression = resolve }))
    await mount()
    const image = photo('compressing')
    await pick([image])
    await click('发现入口')
    await click('保留文字草稿并离开')
    await act(async () => resolveCompression({ file: image, width: 100, height: 80 }))
    expect(api.uploadImage).not.toHaveBeenCalled()
  })

  it('reserves pending upload slots before accepting a second selection', async () => {
    let resolveFirst
    api.uploadImage.mockImplementation(async file => {
      if (file.name === 'first.jpg') return new Promise(resolve => { resolveFirst = resolve })
      return { key: file.name }
    })
    await mount()
    await pick([photo('first'), photo('second')])
    await pick(Array.from({ length: 6 }, (_, index) => photo(`next-${index}`)))
    await act(async () => resolveFirst({ key: 'first.jpg' }))
    expect(container.querySelectorAll('button[aria-label="删除图片"]')).toHaveLength(6)
    expect(api.uploadImage).toHaveBeenCalledTimes(6)
  })

  it('does not redirect an unchanged edit after its save finishes on another page', async () => {
    let resolveSave
    api.updatePost.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve }))
    await mount('/edit/post-1')
    await click('保存')
    await click('发现入口')
    expect(router.state.location.pathname).toBe('/discover')
    await act(async () => resolveSave({ id: 'post-1' }))
    expect(router.state.location.pathname).toBe('/discover')
  })

  it('does not clear a newer draft after a previous editor save finishes late', async () => {
    let resolveSave
    api.updatePost.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve }))
    await mount('/edit/post-1')
    await click('保存')
    await click('发现入口')
    await navigate('/edit/post-1')
    await fill('textarea', '重新进入后继续编辑的新内容')
    await act(async () => resolveSave({ id: 'post-1' }))
    expect(router.state.location.pathname).toBe('/edit/post-1')
    expect(container.querySelector('textarea').value).toBe('重新进入后继续编辑的新内容')
    expect(readPostDraft(postDraftKey(alice.id, 'post-1')).fields.content).toBe('重新进入后继续编辑的新内容')
  })

  it('locks submitted controls while saving and unlocks them without losing text after failure', async () => {
    let rejectSave
    api.updatePost.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSave = reject }))
    await mount('/edit/post-1')
    await fill('textarea', '本次提交的内容')
    await click('保存')
    expect(container.querySelector('textarea').matches(':disabled')).toBe(true)
    expect(container.querySelector('input[type="file"]').matches(':disabled')).toBe(true)
    expect(container.querySelector('button[aria-label="删除图片"]').matches(':disabled')).toBe(true)
    await act(async () => rejectSave(new Error('暂时无法保存')))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('fieldset').disabled).toBe(false)
    expect(container.querySelector('textarea').value).toBe('本次提交的内容')
    expect(readPostDraft(postDraftKey(alice.id, 'post-1')).fields.content).toBe('本次提交的内容')
  })

  it('ignores category changes coming from the bottom publishing entry while a request is pending', async () => {
    let rejectSave
    api.createPost.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSave = reject }))
    await mount()
    await fill('input[placeholder="输入你的需求标题"]', '正在发布的求助')
    await fill('textarea', '分类应与本次发送的内容保持一致')
    await click('发布')
    await navigate('/create', { state: { type: 'idle' }, replace: true })
    expect(container.querySelector('input[placeholder="输入你的需求标题"]')).toBeTruthy()
    await act(async () => rejectSave(new Error('暂时无法发布')))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('input[placeholder="输入你的需求标题"]')).toBeTruthy()
    expect(readPostDraft(postDraftKey(alice.id)).fields.type).toBe('help')
  })

  it('syncs a fresh edit response with its baseline before the user starts changing cached fields', async () => {
    await mount('/')
    client.setQueryData(['post', 'post-1', alice.id], original)
    let resolveRead
    api.getPost.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve }))
    await navigate('/edit/post-1')
    expect(container.querySelector('input[placeholder="输入你的需求标题"]').value).toBe('原始标题')
    const fresh = {
      ...original, type: 'idle', title: '服务器新标题', content: '服务器新描述',
      contact: '测试联系方式', location: '测试位置', images: ['server-latest.jpg'],
    }
    await act(async () => resolveRead(fresh))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('input[placeholder="输入物品名称"]').value).toBe(fresh.title)
    expect(container.querySelector('textarea').value).toBe(fresh.content)
    expect(container.querySelector('input[placeholder="微信号 / 手机号(可选)"]').value).toBe(fresh.contact)
    expect(container.querySelector('input[placeholder="如 3 栋 2 单元"]').value).toBe(fresh.location)
    expect(container.querySelector('img').src).toContain('server-latest.jpg')
    expect(beforeUnload().defaultPrevented).toBe(false)
    expect(sessionStorage.getItem(postDraftKey(alice.id, 'post-1'))).toBeNull()
    await click('保存')
    expect(api.updatePost).toHaveBeenCalledWith('post-1', expect.objectContaining({
      type: fresh.type, title: fresh.title, content: fresh.content,
      contact: fresh.contact, location: fresh.location,
      images: [expect.objectContaining({ key: 'server-latest.jpg' })],
    }))
  })

  it('keeps user edits and their original baseline when a fresh server response arrives', async () => {
    await mount('/')
    client.setQueryData(['post', 'post-1', alice.id], original)
    let resolveRead
    api.getPost.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve }))
    await navigate('/edit/post-1')
    await fill('input[placeholder="输入你的需求标题"]', '用户正在填写的标题')
    await act(async () => resolveRead({ ...original, title: '服务器新标题', content: '服务器新描述', images: ['server-latest.jpg'] }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('input[placeholder="输入你的需求标题"]').value).toBe('用户正在填写的标题')
    expect(container.querySelector('textarea').value).toBe(original.content)
    expect(container.querySelector('img').src).toContain('original.jpg')
    expect(beforeUnload().defaultPrevented).toBe(true)
    expect(readPostDraft(postDraftKey(alice.id, 'post-1')).fields.title).toBe('用户正在填写的标题')
    // 还原用户唯一改动后应仍与原基准相等，不能偷偷换成新响应的基准。
    await fill('input[placeholder="输入你的需求标题"]', original.title)
    expect(beforeUnload().defaultPrevented).toBe(false)
    expect(sessionStorage.getItem(postDraftKey(alice.id, 'post-1'))).toBeNull()
  })

  it('keeps a restored editing draft when cached post data refreshes', async () => {
    await mount('/')
    client.setQueryData(['post', 'post-1', alice.id], original)
    const key = postDraftKey(alice.id, 'post-1')
    sessionStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), fields: {
      type: 'help', title: '恢复的标题', content: '恢复的文字', contact: '', postLocation: original.location,
    } }))
    let resolveRead
    api.getPost.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve }))
    await navigate('/edit/post-1')
    await act(async () => resolveRead({ ...original, title: '服务器新标题', content: '服务器新描述', images: ['server-latest.jpg'] }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('input[placeholder="输入你的需求标题"]').value).toBe('恢复的标题')
    expect(container.querySelector('textarea').value).toBe('恢复的文字')
    expect(container.querySelector('img').src).toContain('original.jpg')
    expect(beforeUnload().defaultPrevented).toBe(true)
    expect(readPostDraft(key).fields.content).toBe('恢复的文字')
  })

  it('keeps unavailable-contact protection with a dirty baseline after decryption recovers', async () => {
    await mount('/')
    client.setQueryData(['post', 'post-1', alice.id], { ...original, contactUnavailable: true })
    let resolveRead
    api.getPost.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve }))
    await navigate('/edit/post-1')
    await fill('input[placeholder="输入你的需求标题"]', '用户只修改标题')
    await act(async () => resolveRead({ ...original, contact: '恢复解密的测试联系方式' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('input[placeholder="微信号 / 手机号(可选)"]').value).toBe('')
    await click('保存')
    expect(api.updatePost).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/edit/post-1')
    expect(toast.error).toHaveBeenCalledWith('联系方式无法加载，请重新填写后再保存')
    await fill('input[placeholder="微信号 / 手机号(可选)"]', '用户重新填写的测试联系方式')
    await click('保存')
    expect(api.updatePost).toHaveBeenCalledWith('post-1', expect.objectContaining({ contact: '用户重新填写的测试联系方式' }))
  })
})
