import { describe, it, expect } from 'vitest'
import { requireText, optionalText, LIMITS, escapeLike } from '../src/validate.js'

describe('requireText', () => {
  it('正常文本 trim 后通过', () => {
    expect(requireText('  hi ', 10, '标题')).toEqual({ ok: true, value: 'hi' })
  })
  it('空 / 纯空白 / 非字符串拒绝', () => {
    expect(requireText('', 10, '标题').ok).toBe(false)
    expect(requireText('   ', 10, '标题').ok).toBe(false)
    expect(requireText(null, 10, '标题').ok).toBe(false)
    expect(requireText(123, 10, '标题').ok).toBe(false)
  })
  it('超长拒绝', () => {
    const r = requireText('a'.repeat(11), 10, '标题')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('10')
  })
})

describe('optionalText', () => {
  it('空值放行返回空串', () => {
    expect(optionalText('', 10, '昵称')).toEqual({ ok: true, value: '' })
    expect(optionalText(null, 10, '昵称')).toEqual({ ok: true, value: '' })
    expect(optionalText(undefined, 10, '昵称')).toEqual({ ok: true, value: '' })
  })
  it('非空 trim 并校验长度', () => {
    expect(optionalText(' bob ', 10, '昵称')).toEqual({ ok: true, value: 'bob' })
    expect(optionalText('a'.repeat(11), 10, '昵称').ok).toBe(false)
  })
})

describe('LIMITS', () => {
  it('关键字段有上限', () => {
    expect(LIMITS.title).toBeGreaterThan(0)
    expect(LIMITS.comment).toBeGreaterThan(0)
    expect(LIMITS.content).toBeGreaterThan(0)
  })
})

describe('escapeLike', () => {
  it('普通文本原样返回', () => {
    expect(escapeLike('打印机')).toBe('打印机')
    expect(escapeLike('hello world')).toBe('hello world')
  })
  it('% 被转义', () => {
    expect(escapeLike('100%')).toBe('100\\%')
  })
  it('_ 被转义', () => {
    expect(escapeLike('a_b')).toBe('a\\_b')
  })
  it('反斜杠被转义', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })
  it('混合通配符全部转义', () => {
    // 输入 %_\ -> 各加一个前导反斜杠
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\')
  })
  it('反斜杠先于通配符处理,不产生二次转义', () => {
    // "\%" 应为 \\(转义反斜杠) + \%(转义百分号),而非把新增的反斜杠再转义
    expect(escapeLike('\\%')).toBe('\\\\\\%')
  })
})
