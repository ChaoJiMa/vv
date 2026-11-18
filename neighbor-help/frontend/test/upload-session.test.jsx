import { act, createContext, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { api } from '../src/api'
import { toast } from '../src/toast'
import { downscaleImage } from '../src/utils/image'
import CreatePost from '../src/pages/CreatePost'
import Profile from '../src/pages/Profile'

vi.mock('../src/components/BottomNav', () => ({ default: () => null }))
vi.mock('../src/components/BottomSheet', () => ({ default: ({ open, children }) => open ? <div>{children}</div> : null }))
vi.mock('../src/theme/useAppTheme', () => ({ useAppTheme: () => ({ mode: 'light', setMode: () => {} }) }))
vi.mock('../src/utils/image', async importOriginal => ({ ...await importOriginal(), downscaleImage: vi.fn() }))

describe('uploads keep the session that selected the files', () => {
  const alice = { id: 'alice', nickname: 'Alice' }
  const bob = { id: 'bob', nickname: 'Bob' }
  let root, container, client, auth, page, router
  const PageContext = createContext(null)
  // 发帖页依赖 data router 的离开拦截；上下文保留原测试按阶段挂载页面的方式。
  function UploadPage() {
    const kind = useContext(PageContext)
    return kind === 'post' ? <CreatePost /> : kind === 'avatar' ? <Profile /> : null
  }
  function Probe() { auth = useAuth(); return null }
  function deferred() {
    let resolve
    const promise = new Promise(yes => { resolve = yes })
    return { promise, resolve }
  }
  async function render() {
    await act(async () => root.render(
      <QueryClientProvider client={client}><AuthProvider><Probe /><PageContext value={page}>
        <RouterProvider router={router} />
      </PageContext></AuthProvider></QueryClientProvider>
    ))
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label || el.getAttribute('aria-label') === label)
    expect(button).toBeTruthy()
    await act(async () => button.click())
  }
  async function open(kind) {
    await render()
    page = kind
    await render()
    if (kind === 'avatar') {
      await click('更多')
      await click('编辑资料')
    }
  }
  async function pick(files) {
    const input = container.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }
  async function switchAndUnmount() {
    await act(async () => auth.login('bob-token', bob))
    page = null
    await render()
  }
  const photo = name => new File([name], `${name}.jpg`, { type: 'image/jpeg' })
  const response = key => new Response(JSON.stringify({ code: 200, data: { key } }))

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('token', 'alice-token')
    vi.spyOn(api, 'getMe').mockResolvedValue(alice)
    vi.spyOn(api, 'getMenus').mockResolvedValue([])
    vi.spyOn(api, 'getMyStats').mockResolvedValue({ helped: 0, received: 0 })
    vi.spyOn(api, 'getMyPosts').mockResolvedValue({ list: [], page: 1, hasMore: false })
    vi.spyOn(api, 'logout').mockResolvedValue({ success: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(toast, 'error').mockImplementation(() => {})
    downscaleImage.mockReset().mockImplementation(async file => ({ file, width: 100, height: 80 }))
    vi.stubGlobal('fetch', vi.fn(async () => response('uploaded.jpg')))
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    page = null
    router = createMemoryRouter([{ path: '*', element: <UploadPage /> }], {
      initialEntries: [{ pathname: '/create', state: { type: 'help' } }],
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    router.dispose()
    client.clear()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['post', 'avatar'])('stops %s uploads after switching accounts during compression and unmounting', async kind => {
    const processing = deferred()
    const file = photo('alice-private')
    downscaleImage.mockReturnValueOnce(processing.promise)
    await open(kind)
    await pick([file])
    await switchAndUnmount()
    await act(async () => processing.resolve({ file, width: 100, height: 80 }))
    expect(fetch).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(auth.user.id).toBe('bob')
  })

  it('stops all queued post images after logout during compression', async () => {
    const processing = deferred()
    const files = [photo('first'), photo('second')]
    downscaleImage.mockReturnValueOnce(processing.promise)
    await open('post')
    await pick(files)
    await act(async () => auth.logout())
    page = null
    await render()
    await act(async () => processing.resolve({ file: files[0] }))
    expect(fetch).not.toHaveBeenCalled()
    expect(downscaleImage).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not start remaining images after an in-flight upload belongs to a stale session', async () => {
    const upload = deferred()
    fetch.mockReturnValueOnce(upload.promise)
    await open('post')
    await pick([photo('first'), photo('second')])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer alice-token')
    await switchAndUnmount()
    await act(async () => upload.resolve(response('first.jpg')))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(downscaleImage).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('clears every queued placeholder when a batch is interrupted', async () => {
    const processing = deferred()
    const file = photo('first')
    downscaleImage.mockReturnValueOnce(processing.promise)
    await open('post')
    await pick([file, photo('second')])
    await act(async () => auth.login('bob-token', bob))
    await act(async () => processing.resolve({ file }))
    expect(fetch).not.toHaveBeenCalled()
    expect([...container.querySelectorAll('div')].filter(el => el.textContent === '…')).toHaveLength(0)
    await pick([photo('bob-new')])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer bob-token')
    expect(container.querySelectorAll('button[aria-label="删除图片"]')).toHaveLength(1)
  })

  it('continues an unchanged session batch after an ordinary upload failure', async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, message: 'temporary error' }), { status: 500 }))
    await open('post')
    await pick([photo('first'), photo('second')])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(downscaleImage).toHaveBeenCalledTimes(2)
    expect(container.querySelectorAll('button[aria-label="删除图片"]')).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('temporary error')
  })

  it('uploads and saves an avatar normally in its original session', async () => {
    vi.spyOn(api, 'updateMe').mockResolvedValue({ success: true })
    await open('avatar')
    await pick([photo('avatar')])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer alice-token')
    await click('保存')
    expect(api.updateMe).toHaveBeenCalledWith(expect.objectContaining({ avatar: 'uploaded.jpg' }))
    expect(auth.user.avatar).toBe('uploaded.jpg')
  })
})
