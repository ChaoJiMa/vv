import { describe, expect, it } from 'vitest'
import { getTypeTheme, TYPE_THEME } from '../src/utils/typeTheme'

/** 菜单扩展或异常类型统一回退，原型同名字段也不能吞掉默认配色。 */
describe('分类主题回退', () => {
  it.each(['unknown', 'constructor', 'toString', '__proto__'])('未知类型 %s 仍提供完整默认主题', (type) => {
    expect(getTypeTheme(type)).toEqual(TYPE_THEME.help)
    expect(getTypeTheme(type, { label: '自定义分类' })).toEqual({ ...TYPE_THEME.help, label: '自定义分类' })
  })
})
