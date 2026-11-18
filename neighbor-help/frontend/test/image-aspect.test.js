import { describe, expect, it } from 'vitest'
import { estimateCardHeight } from '../src/utils/imageAspect'

/** 角色头区改变真实卡内高度；这些边界防止仍按旧标签行分列，或误给照片添加插画高度。 */
describe('首页糖果卡片列高估算', () => {
  const post = { type: 'help', title: '借用工具', content: '今晚归还。', status: 'open' }
  const candy = { variant: 'candy' }

  it('只在显式糖果无图卡中计入角色，照片和默认变体沿用原估高', () => {
    const photo = { ...post, images: ['example-cover'] }
    expect(estimateCardHeight(166, 1, post, { variant: 'default' }))
      .toBe(estimateCardHeight(166, 1, post))
    expect(estimateCardHeight(166, 1, photo, candy))
      .toBe(estimateCardHeight(166, 1, photo))
    expect(estimateCardHeight(166, 1, post, candy))
      .toBeGreaterThan(estimateCardHeight(166, 1, post))
  })

  it('列宽不足以并排标签和角色时计入换行，而不是继续使用单行头区', () => {
    // 166px 列的内容宽 142px，四字标签与72px角色可并排；160px 列则需换行。
    expect(estimateCardHeight(160, 1, post, candy) - estimateCardHeight(166, 1, post, candy))
      .toBeGreaterThanOrEqual(27)
    // 320px 视口对应约139px列，64px角色与标签分两行，比默认标签区多70px。
    expect(estimateCardHeight(139, 1, post, candy) - estimateCardHeight(139, 1, post))
      .toBe(70)
  })

  it('关闭状态同时考虑标签内部换行和角色换行', () => {
    const closed = { ...post, status: 'closed' }
    expect(estimateCardHeight(139, 1, closed, candy) - estimateCardHeight(139, 1, closed))
      .toBe(70)
    expect(estimateCardHeight(139, 1, closed, candy))
      .toBeGreaterThan(estimateCardHeight(139, 1, post, candy))
  })

  it('菜单长标签参与估高，不能始终以四字标准分类估算', () => {
    const longMenu = { label: '这是一个需要完整显示的邻里互助分类名称' }
    expect(estimateCardHeight(166, 1, post, { ...candy, menu: longMenu }))
      .toBeGreaterThan(estimateCardHeight(166, 1, post, candy))
  })
})
