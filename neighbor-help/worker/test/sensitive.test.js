import { describe, it, expect } from 'vitest'
import { matchSensitive } from '../src/sensitive.js'

// 敏感词表现已存于 D1(app_config),findSensitive(env, text) 需要 DB;
// 这里直接测纯函数 matchSensitive(words, text)——真正的匹配逻辑都在它里面。
const WORDS = ['赌博', '兼职刷单', '色情', '微信加我转账']

describe('matchSensitive', () => {
  it('干净文本返回 null', () => {
    expect(matchSensitive(WORDS, '帮忙取个快递,谢谢邻居')).toBeNull()
    expect(matchSensitive(WORDS, '')).toBeNull()
    expect(matchSensitive(WORDS, null)).toBeNull()
    expect(matchSensitive(WORDS, undefined)).toBeNull()
  })

  it('命中敏感词返回原词', () => {
    expect(matchSensitive(WORDS, '有靠谱的赌博平台吗')).toBe('赌博')
    expect(matchSensitive(WORDS, '招募兼职刷单日结')).toBe('兼职刷单')
  })

  it('归一化:大小写 / 分隔符规避也能命中', () => {
    // 拆字:用空格/标点分隔
    expect(matchSensitive(WORDS, '赌 博')).toBe('赌博')
    expect(matchSensitive(WORDS, '赌.博')).toBe('赌博')
    expect(matchSensitive(WORDS, '兼职-刷-单')).toBe('兼职刷单')
  })

  it('返回首个命中即可', () => {
    const hit = matchSensitive(WORDS, '既有赌博又有色情')
    expect(['赌博', '色情']).toContain(hit)
  })

  it('词表非数组安全返回 null', () => {
    expect(matchSensitive(null, '赌博')).toBeNull()
    expect(matchSensitive(undefined, '赌博')).toBeNull()
  })
})
