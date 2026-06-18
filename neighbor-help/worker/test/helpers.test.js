import { describe, it, expect } from 'vitest'
import { pickValidHelpers } from '../src/routes/helpers.js'

const OWNER = 'owner-1'
// 本帖响应者∪评论者(SQL 已排除帖主),作为允许采纳的集合
const ALLOW = new Set(['u-a', 'u-b', 'u-c'])

describe('pickValidHelpers(关帖采纳筛选)', () => {
  it('保留 allow 集合内的采纳者,归一化 thanked 为 1/0', () => {
    const out = pickValidHelpers(
      [{ helperId: 'u-a', thanked: true }, { helperId: 'u-b', thanked: false }],
      ALLOW, OWNER,
    )
    expect(out).toEqual([
      { helperId: 'u-a', thanked: 1 },
      { helperId: 'u-b', thanked: 0 },
    ])
  })

  it('剔除不在 allow 集合内的人(非响应者/评论者)', () => {
    const out = pickValidHelpers([{ helperId: 'stranger' }, { helperId: 'u-c' }], ALLOW, OWNER)
    expect(out).toEqual([{ helperId: 'u-c', thanked: 0 }])
  })

  it('排除帖主自己(即便在 allow 集合里)', () => {
    const allow = new Set([OWNER, 'u-a'])
    const out = pickValidHelpers([{ helperId: OWNER, thanked: true }, { helperId: 'u-a' }], allow, OWNER)
    expect(out).toEqual([{ helperId: 'u-a', thanked: 0 }])
  })

  it('同一人重复提交只取一次(保留首次)', () => {
    const out = pickValidHelpers(
      [{ helperId: 'u-a', thanked: true }, { helperId: 'u-a', thanked: false }],
      ALLOW, OWNER,
    )
    expect(out).toEqual([{ helperId: 'u-a', thanked: 1 }])
  })

  it('thanked 各种真值/假值归一化', () => {
    const out = pickValidHelpers(
      [{ helperId: 'u-a', thanked: 1 }, { helperId: 'u-b', thanked: 0 }, { helperId: 'u-c' }],
      ALLOW, OWNER,
    )
    expect(out.map(h => h.thanked)).toEqual([1, 0, 0])
  })

  it('空 / 非数组 / 缺 helperId 安全返回 []', () => {
    expect(pickValidHelpers([], ALLOW, OWNER)).toEqual([])
    expect(pickValidHelpers(null, ALLOW, OWNER)).toEqual([])
    expect(pickValidHelpers('x', ALLOW, OWNER)).toEqual([])
    expect(pickValidHelpers([{ thanked: true }, {}, null], ALLOW, OWNER)).toEqual([])
  })

  it('allow 传数组也可(内部转 Set)', () => {
    expect(pickValidHelpers([{ helperId: 'u-a' }], ['u-a'], OWNER)).toEqual([{ helperId: 'u-a', thanked: 0 }])
  })
})
