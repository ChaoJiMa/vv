import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api'
import { captureSession, setSessionToken } from '../src/session'

describe('API session invalidation', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('preserves credentials when the server is unavailable', async () => {
    localStorage.setItem('token', 'existing-token')
    fetch.mockResolvedValue(new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 }))
    await expect(api.getMe()).rejects.toMatchObject({ code: 503 })
    expect(localStorage.getItem('token')).toBe('existing-token')
  })

  it('clears credentials on a current-session 401', async () => {
    localStorage.setItem('token', 'expired-token')
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 401 }), { status: 401 }))
    await expect(api.getMe()).rejects.toMatchObject({ code: 401 })
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('does not clear a new account token when an old request returns 401', async () => {
    localStorage.setItem('token', 'old-token')
    let resolve
    fetch.mockReturnValue(new Promise(yes => { resolve = yes }))
    const pending = api.getMe()
    localStorage.setItem('token', 'new-token')
    resolve(new Response(JSON.stringify({ code: 401 }), { status: 401 }))
    await expect(pending).rejects.toMatchObject({ name: 'StaleSessionError' })
    expect(localStorage.getItem('token')).toBe('new-token')
  })

  it.each(['different account', 'same token with a new session revision'])(
    'rejects an upload before sending when its expected session is stale: %s', async change => {
      setSessionToken('alice-token')
      const session = captureSession()
      setSessionToken(change === 'different account' ? 'bob-token' : 'alice-token')
      await expect(api.uploadImage(new File(['private'], 'image.jpg'), {}, session))
        .rejects.toMatchObject({ name: 'StaleSessionError' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )
})
