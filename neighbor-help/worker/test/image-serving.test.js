import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from './support/database.js'
import imageRoutes from '../src/routes/images.js'

describe('image revalidation', () => {
  let db, env
  const metadata = { httpEtag: '"current"', httpMetadata: { contentType: 'image/jpeg' } }
  beforeEach(() => {
    db = createDatabase()
    env = { DB: db, IMAGES: { get: vi.fn(async () => ({ ...metadata, body: new Uint8Array([1, 2, 3]) })) } }
  })
  afterEach(() => db.sqlite.close())

  it.each(['"current"', 'W/"current"', '"older", "current"', '*'])(
    'passes If-None-Match to R2 and returns 304 from metadata alone: %s', async condition => {
      env.IMAGES.get.mockResolvedValue(metadata)
      const result = await imageRoutes.request('http://localhost/img/photo.jpg', {
        headers: { 'If-None-Match': condition, 'If-Match': '"unrelated"', Range: 'bytes=0-1' },
      }, env)
      expect(result.status).toBe(304)
      expect(await result.text()).toBe('')
      expect(result.headers.get('ETag')).toBe('"current"')
      expect(result.headers.get('Cache-Control')).toBe('public, no-cache')
      expect(env.IMAGES.get).toHaveBeenCalledTimes(1)
      const [key, options] = env.IMAGES.get.mock.calls[0]
      expect(key).toBe('photo.jpg')
      expect([...options.onlyIf]).toEqual([['if-none-match', condition]])
      expect(options.range).toBeUndefined()
    }
  )

  it('serves the new body when R2 reports an ETag mismatch', async () => {
    const result = await imageRoutes.request('http://localhost/img/photo.jpg', { headers: { 'If-None-Match': '"older"' } }, env)
    expect(result.status).toBe(200)
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3])
    expect(result.headers.get('ETag')).toBe('"current"')
  })

  it('serves ordinary reads without adding an R2 metadata lookup', async () => {
    const result = await imageRoutes.request('http://localhost/img/photo.jpg', {}, env)
    expect(result.status).toBe(200)
    expect(env.IMAGES.get).toHaveBeenCalledExactlyOnceWith('photo.jpg', undefined)
    expect(result.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('checks deletion claims before conditional reads so a deleted image never receives 304', async () => {
    db.sqlite.prepare('INSERT INTO image_deletions (image_key, claimed_at) VALUES (?, ?)').run('photo.jpg', Date.now())
    const result = await imageRoutes.request('http://localhost/img/photo.jpg', { headers: { 'If-None-Match': '"current"' } }, env)
    expect(result.status).toBe(404)
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(env.IMAGES.get).not.toHaveBeenCalled()
  })

  it('returns 404 when a conditional read finds no R2 object', async () => {
    env.IMAGES.get.mockResolvedValue(null)
    const result = await imageRoutes.request('http://localhost/img/photo.jpg', { headers: { 'If-None-Match': '"older"' } }, env)
    expect(result.status).toBe(404)
  })
})
