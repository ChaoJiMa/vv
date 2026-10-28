import { describe, it, expect } from 'vitest'
import { canSeeContact, encryptContact, decryptContact, omitContact } from '../src/contactCrypto.js'

describe('omitContact', () => {
  it('剔除 contact 字段', () => {
    expect(omitContact({ id: '1', contact: '138', title: 't' })).toEqual({ id: '1', title: 't' })
    expect(omitContact({ id: '2' })).toEqual({ id: '2' })
  })
})

describe('canSeeContact', () => {
  it('游客不可见', () => {
    expect(canSeeContact(null, 'author', false)).toBe(false)
    expect(canSeeContact(undefined, 'author', true)).toBe(false)
  })

  it('路人已登录但未响应不可见', () => {
    expect(canSeeContact('other', 'author', false)).toBe(false)
  })

  it('作者可见', () => {
    expect(canSeeContact('author', 'author', false)).toBe(true)
  })

  it('已响应用户可见', () => {
    expect(canSeeContact('helper', 'author', true)).toBe(true)
  })
})

const KEY = 'a'.repeat(64) // 32 bytes hex

describe('encryptContact / decryptContact', () => {
  it('往返加密解密', async () => {
    const enc = await encryptContact('13800138000', KEY)
    expect(enc.startsWith('enc:v1:')).toBe(true)
    expect(enc).not.toContain('13800138000')
    expect(await decryptContact(enc, KEY)).toBe('13800138000')
  })

  it('历史明文原样返回', async () => {
    expect(await decryptContact('微信abc', KEY)).toBe('微信abc')
  })

  it('空值安全', async () => {
    expect(await encryptContact('', KEY)).toBe('')
    expect(await encryptContact(null, KEY)).toBe('')
    expect(await decryptContact('', KEY)).toBe('')
    expect(await decryptContact(null, KEY)).toBe('')
  })

  it('无 key 时写入明文', async () => {
    expect(await encryptContact('13800138000', '')).toBe('13800138000')
    expect(await encryptContact('13800138000', undefined)).toBe('13800138000')
  })
})
