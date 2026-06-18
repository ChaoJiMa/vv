import { describe, it, expect } from 'vitest'
import { validateImage, isValidKey, sanitizeImages, MAX_IMAGE_BYTES, MAX_IMAGES_PER_POST } from '../src/images.js'

describe('validateImage', () => {
  it('合法图片返回 ext', () => {
    expect(validateImage({ type: 'image/jpeg', size: 1000 })).toEqual({ ok: true, ext: 'jpg' })
    expect(validateImage({ type: 'image/png', size: 1000 }).ext).toBe('png')
    expect(validateImage({ type: 'image/webp', size: 1000 }).ext).toBe('webp')
    expect(validateImage({ type: 'image/gif', size: 1000 }).ext).toBe('gif')
  })
  it('不支持的类型拒绝', () => {
    expect(validateImage({ type: 'image/bmp', size: 1000 }).ok).toBe(false)
    expect(validateImage({ type: 'application/pdf', size: 1000 }).ok).toBe(false)
    expect(validateImage({ type: '', size: 1000 }).ok).toBe(false)
  })
  it('空 / 超大拒绝', () => {
    expect(validateImage({ type: 'image/jpeg', size: 0 }).ok).toBe(false)
    expect(validateImage({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 }).ok).toBe(false)
    expect(validateImage({ type: 'image/jpeg', size: MAX_IMAGE_BYTES }).ok).toBe(true)
  })
})

describe('isValidKey', () => {
  it('合法 key 通过', () => {
    expect(isValidKey('abc123def456.jpg')).toBe(true)
    expect(isValidKey('deadbeef.webp')).toBe(true)
  })
  it('路径穿越 / 非法扩展名 / 畸形拒绝', () => {
    expect(isValidKey('../secret.jpg')).toBe(false)
    expect(isValidKey('a/b.jpg')).toBe(false)
    expect(isValidKey('abc.txt')).toBe(false)
    expect(isValidKey('abc')).toBe(false)
    expect(isValidKey('')).toBe(false)
    expect(isValidKey(null)).toBe(false)
  })
})

describe('sanitizeImages', () => {
  it('只保留合法 key', () => {
    expect(sanitizeImages(['abc123.jpg', '../evil.png', 'x.txt', 'ok.webp']))
      .toEqual(['abc123.jpg', 'ok.webp'])
  })
  it('去重', () => {
    expect(sanitizeImages(['a1.jpg', 'a1.jpg', 'b2.png'])).toEqual(['a1.jpg', 'b2.png'])
  })
  it('截断到上限', () => {
    const many = Array.from({ length: 20 }, (_, i) => `k${i}.jpg`)
    expect(sanitizeImages(many)).toHaveLength(MAX_IMAGES_PER_POST)
  })
  it('非数组 / 空一律返回 []', () => {
    expect(sanitizeImages(null)).toEqual([])
    expect(sanitizeImages(undefined)).toEqual([])
    expect(sanitizeImages('abc.jpg')).toEqual([])
    expect(sanitizeImages({ 0: 'a.jpg' })).toEqual([])
    expect(sanitizeImages([123, {}, null, true])).toEqual([])
  })
})
