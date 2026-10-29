import { describe, it, expect } from 'vitest'
import {
  detectImageMime, validateImage, isValidKey, sanitizeImages, parseStoredImages,
  imageKeys, readImageSize, MAX_IMAGE_BYTES,
} from '../src/images.js'

describe('detectImageMime', () => {
  it('识别 JPEG', () => {
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  })
  it('识别 PNG', () => {
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
  })
  it('识别 GIF', () => {
    expect(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
  })
  it('识别 WebP (RIFF....WEBP)', () => {
    const b = new Uint8Array(12)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(detectImageMime(b)).toBe('image/webp')
  })
  it('拒绝非图片', () => {
    expect(detectImageMime(new Uint8Array([0x3c, 0x73, 0x63, 0x72]))).toBe(null) // <scr
    expect(detectImageMime(new Uint8Array([1, 2, 3]))).toBe(null)
  })
})

describe('validateImage with bytes', () => {
  it('以 magic 为准，忽略伪造 MIME', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    const r = validateImage({ type: 'image/jpeg', size: png.length, bytes: png })
    expect(r).toEqual({ ok: true, ext: 'png', mime: 'image/png' })
  })

  it('无有效 magic 拒绝', () => {
    const fake = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    const r = validateImage({ type: 'image/jpeg', size: fake.length, bytes: fake })
    expect(r.ok).toBe(false)
  })

  it('无 bytes 时仍按 type（兼容旧调用）', () => {
    expect(validateImage({ type: 'image/png', size: 100 })).toEqual({ ok: true, ext: 'png', mime: 'image/png' })
  })

  it('有 bytes 时以 byteLength 为准，忽略伪造 size', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    expect(validateImage({ type: 'image/png', size: 1, bytes: png }).ok).toBe(true)
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1)
    huge[0] = 0xff
    huge[1] = 0xd8
    huge[2] = 0xff
    expect(validateImage({ type: 'image/jpeg', size: 100, bytes: huge }).ok).toBe(false)
  })
})

describe('isValidKey / sanitizeImages', () => {
  it('合法 key', () => {
    expect(isValidKey('abc123.jpg')).toBe(true)
    expect(isValidKey('../x.jpg')).toBe(false)
  })
  it('清洗 images 为带 key 的对象并去重', () => {
    expect(sanitizeImages(['a.jpg', 'a.jpg', '../b.png', 'c.webp'])).toEqual([
      { key: 'a.jpg' },
      { key: 'c.webp' },
    ])
  })
  it('保留合法宽高', () => {
    expect(sanitizeImages([{ key: 'a.jpg', width: 100, height: 200 }])).toEqual([
      { key: 'a.jpg', width: 100, height: 200 },
    ])
  })
  it('parseStoredImages 兼容旧纯 key 数组', () => {
    expect(parseStoredImages('["a.jpg"]')).toEqual([{ key: 'a.jpg' }])
    expect(imageKeys('[{"key":"a.jpg","width":10,"height":20}]')).toEqual(['a.jpg'])
  })
})

describe('readImageSize', () => {
  it('读 PNG IHDR', () => {
    const b = new Uint8Array(24)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    // width=2 height=3 at offset 16
    b[16] = 0; b[17] = 0; b[18] = 0; b[19] = 2
    b[20] = 0; b[21] = 0; b[22] = 0; b[23] = 3
    expect(readImageSize(b)).toEqual({ width: 2, height: 3 })
  })
})
