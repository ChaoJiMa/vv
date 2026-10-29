import { describe, it, expect } from 'vitest'
import { pairUsers, displayPostTitle, canOpenPostDm, EMPTY_CONV_TTL_MS } from '../src/conversation.js'

describe('pairUsers', () => {
  it('按字典序排列双方 id', () => {
    expect(pairUsers('b', 'a')).toEqual(['a', 'b'])
    expect(pairUsers('a', 'b')).toEqual(['a', 'b'])
  })
  it('相同输入稳定', () => {
    expect(pairUsers('x', 'y')).toEqual(pairUsers('y', 'x'))
  })
})

describe('displayPostTitle', () => {
  it('帖已删固定文案', () => {
    expect(displayPostTitle('任意标题', true)).toBe('原帖已删除')
  })
  it('有标题返回 trim 后标题', () => {
    expect(displayPostTitle('  互助  ', false)).toBe('互助')
  })
  it('无标题视为已删文案', () => {
    expect(displayPostTitle('', false)).toBe('原帖已删除')
    expect(displayPostTitle(null, false)).toBe('原帖已删除')
  })
})

describe('canOpenPostDm', () => {
  const author = 'author1'
  const visitor = 'user2'
  const other = 'user3'

  it('访客对帖主允许', () => {
    expect(canOpenPostDm(author, visitor, author)).toBe(true)
  })
  it('帖主对邻居允许', () => {
    expect(canOpenPostDm(author, author, visitor)).toBe(true)
  })
  it('两人皆非帖主拒绝', () => {
    expect(canOpenPostDm(author, visitor, other)).toBe(false)
  })
  it('自己对自己拒绝', () => {
    expect(canOpenPostDm(author, author, author)).toBe(false)
  })
})

describe('EMPTY_CONV_TTL_MS', () => {
  it('为空会话保留 24 小时', () => {
    expect(EMPTY_CONV_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })
})
