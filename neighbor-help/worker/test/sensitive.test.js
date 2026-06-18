import { describe, it, expect } from 'vitest'
import { findSensitive } from '../src/sensitive.js'

describe('findSensitive', () => {
  it('干净文本返回 null', () => {
    expect(findSensitive('帮忙取个快递,谢谢邻居')).toBeNull()
    expect(findSensitive('')).toBeNull()
    expect(findSensitive(null)).toBeNull()
    expect(findSensitive(undefined)).toBeNull()
  })

  it('命中敏感词返回原词', () => {
    expect(findSensitive('有靠谱的赌博平台吗')).toBe('赌博')
    expect(findSensitive('招募兼职刷单日结')).toBe('兼职刷单')
  })

  it('归一化:大小写 / 分隔符规避也能命中', () => {
    // 拆字:用空格/标点分隔
    expect(findSensitive('赌 博')).toBe('赌博')
    expect(findSensitive('赌.博')).toBe('赌博')
    expect(findSensitive('兼职-刷-单')).toBe('兼职刷单')
  })

  it('返回首个命中即可', () => {
    const hit = findSensitive('既有赌博又有色情')
    expect(['赌博', '色情']).toContain(hit)
  })
})
