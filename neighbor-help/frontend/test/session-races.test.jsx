import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { api } from '../src/api'
import Profile from '../src/pages/Profile'

vi.mock('../src/components/BottomNav', () => ({ default: () => null }))
vi.mock('../src/components/BottomSheet', () => ({ default: ({ open, children }) => open ? <div>{children}</div> : null }))
vi.mock('../src/theme/useAppTheme', () => ({ useAppTheme: () => ({ mode: 'light', setMode: () => {} }) }))

describe('session race regressions with actual components', () => {
  let root, container, client, auth, showProfile
  const alice = { id: 'alice', username: 'alice', nickname: 'Alice', building: '1', unit: '101' }
  const bob = { id: 'bob', username: 'bob', nickname: 'Bob', building: '2', unit: '202' }
  function Probe() { auth = useAuth(); return null }
  async function render() {
    await act(async () => root.render(
      <QueryClientProvider client={client}><AuthProvider><Probe /><MemoryRouter>
        {showProfile ? <Profile /> : null}
      </MemoryRouter></AuthProvider></QueryClientProvider>
    ))
  }
  function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(el => el.textContent.trim() === label || el.getAttribute('aria-label') === label)
    expect(button, `button ${label}`).toBeTruthy()
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
  }
  async function inputValue(input, value) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('token', 'alice-token')
    vi.spyOn(api, 'getMe').mockResolvedValue(alice)
    vi.spyOn(api, 'getMenus').mockResolvedValue([])
    vi.spyOn(api, 'getMyStats').mockResolvedValue({ helped: 0, received: 0 })
    vi.spyOn(api, 'getMyPosts').mockResolvedValue({ list: [], page: 1, hasMore: false })
    vi.spyOn(api, 'logout').mockResolvedValue({ success: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    showProfile = false
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

  it('restores the new user and clears private cache after a second tab switches accounts', async () => {
    await render()
    client.setQueryData(['conversations', 'alice'], { list: ['alice-private'] })
    api.getMe.mockResolvedValueOnce(bob)
    localStorage.setItem('token', 'bob-token')
    await act(async () => window.dispatchEvent(new StorageEvent('storage', {
      key: 'token', oldValue: 'alice-token', newValue: 'bob-token', storageArea: localStorage,
    })))
    expect(auth.user.id).toBe('bob')
    expect(localStorage.getItem('token')).toBe('bob-token')
    expect(client.getQueryData(['conversations', 'alice'])).toBeUndefined()
  })

  it('ignores a late restoration 401 after a second tab switches accounts', async () => {
    api.getMe.mockRestore()
    const pending = deferred()
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(new Response(JSON.stringify({ code: 200, data: bob }))))
    await render()
    localStorage.setItem('token', 'bob-token')
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', oldValue: 'alice-token', newValue: 'bob-token' }))
      pending.resolve(new Response(JSON.stringify({ code: 401 }), { status: 401 }))
    })
    expect(localStorage.getItem('token')).toBe('bob-token')
    expect(auth.user.id).toBe('bob')
  })

  it('ignores an old profile save after switching accounts', async () => {
    const pending = deferred()
    vi.spyOn(api, 'updateMe').mockReturnValue(pending.promise)
    await render()
    showProfile = true
    await render()
    await click('更多')
    await click('编辑资料')
    await click('保存')
    expect(api.updateMe).toHaveBeenCalledTimes(1)
    await act(async () => auth.logout())
    showProfile = false
    await render()
    await act(async () => auth.login('bob-token', bob))
    await act(async () => pending.resolve({ success: true }))
    expect(auth.user.id).toBe('bob')
    expect(auth.user.nickname).toBe('Bob')
    expect(auth.user.building).toBe('2')
  })

  it('ignores a late password-change response after switching accounts', async () => {
    const pending = deferred()
    vi.spyOn(api, 'changePassword').mockReturnValue(pending.promise)
    await render()
    showProfile = true
    await render()
    await click('更多')
    await click('修改密码')
    const inputs = [...container.querySelectorAll('input[type="password"]')]
    expect(inputs).toHaveLength(3)
    for (const input of inputs) await inputValue(input, 'password123')
    await click('确认修改')
    expect(api.changePassword).toHaveBeenCalledTimes(1)
    await act(async () => auth.logout())
    showProfile = false
    await render()
    await act(async () => auth.login('bob-token', bob))
    await act(async () => pending.resolve({ token: 'alice-new-token' }))
    expect(auth.user.id).toBe('bob')
    expect(localStorage.getItem('token')).toBe('bob-token')
  })
})
