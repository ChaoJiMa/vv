import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { api } from '../src/api'

vi.mock('../src/api', () => ({ api: {
  getMe: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(), logout: vi.fn(),
} }))

describe('session restoration and account changes', () => {
  let root, container, client, auth
  function Probe() {
    auth = useAuth()
    return <span>{auth.user?.id || 'anonymous'}</span>
  }
  async function mount() {
    await act(async () => root.render(
      <StrictMode><QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider></StrictMode>
    ))
  }
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    api.setToken.mockImplementation(token => localStorage.setItem('token', token))
    api.clearToken.mockImplementation(() => localStorage.removeItem('token'))
    api.logout.mockResolvedValue({ success: true })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  })

  it.each([new TypeError('offline'), Object.assign(new Error('server unavailable'), { code: 500 })])(
    'keeps credentials on temporary errors and restores the session on retry', async error => {
      localStorage.setItem('token', 'existing-token')
      api.getMe.mockRejectedValueOnce(error)
      await mount()
      expect(api.getMe).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem('token')).toBe('existing-token')
      expect(auth.restoreError).toBe(error)
      expect(auth.loading).toBe(false)
      api.getMe.mockResolvedValueOnce({ id: 'owner' })
      await act(async () => auth.retrySession())
      expect(auth.user.id).toBe('owner')
      expect(auth.restoreError).toBeNull()
      expect(localStorage.getItem('token')).toBe('existing-token')
    }
  )

  it('retries restoration automatically when connectivity returns', async () => {
    localStorage.setItem('token', 'existing-token')
    api.getMe.mockRejectedValueOnce(new TypeError('offline'))
    await mount()
    api.getMe.mockResolvedValueOnce({ id: 'owner' })
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(auth.user.id).toBe('owner')
    expect(auth.restoreError).toBeNull()
  })

  it('clears invalid credentials and private cache on confirmed 401', async () => {
    localStorage.setItem('token', 'expired-token')
    client.setQueryData(['conversations', 'old-user'], { privateMessage: 'secret' })
    api.getMe.mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 401 }))
    await mount()
    expect(localStorage.getItem('token')).toBeNull()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(auth.user).toBeNull()
    expect(auth.restoreError).toBeNull()
  })

  it('clears previous account data on both login and logout', async () => {
    await mount()
    client.setQueryData(['conversations', 'old-user'], { privateMessage: 'secret' })
    await act(async () => auth.login('new-token', { id: 'new-user' }))
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(auth.user.id).toBe('new-user')
    client.setQueryData(['myPosts', '', 'new-user'], ['private-post'])
    await act(async () => auth.logout())
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(localStorage.getItem('token')).toBeNull()
    expect(auth.user).toBeNull()
  })

  it.each(['success', 'unauthorized'])('ignores a late %s result from the previous session', async result => {
    localStorage.setItem('token', 'old-token')
    let resolve, reject
    api.getMe.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no }))
    await mount()
    await act(async () => auth.login('new-token', { id: 'new-user' }))
    await act(async () => {
      if (result === 'success') resolve({ id: 'old-user' })
      else reject(Object.assign(new Error('expired'), { code: 401 }))
    })
    expect(auth.user.id).toBe('new-user')
    expect(localStorage.getItem('token')).toBe('new-token')
  })
})
