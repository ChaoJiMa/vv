import { describe, expect, it } from 'vitest'
import { createMascotColorMatrix, MASCOT_COLORS } from '../src/utils/mascotColor'

const columnKeys = ['pink', 'yellow', 'lilac', 'blue']
const rgb = hex => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255)

/** 按 SVG 矩阵语义实际变换 RGBA，不复刻生成算法或锁定某一份系数字面量。 */
function applyMatrix(result, rgba) {
  const values = result.values.trim().split(/\s+/).map(Number)
  expect(values).toHaveLength(20)
  expect(values.every(Number.isFinite)).toBe(true)
  return [0, 1, 2, 3].map(row => (
    rgba.reduce((sum, value, column) => sum + value * values[row * 5 + column], values[row * 5 + 4])
  ))
}

const colorCases = columnKeys.flatMap((sourceKey, sourceColumn) => (
  [...columnKeys, '#0b4Da7', '#000000', '#ffffff']
    .filter(color => color !== sourceKey)
    .map(color => ({ sourceKey, sourceColumn, color }))
))

describe('角色颜色独立变换', () => {
  it.each(colorCases)('源列 $sourceColumn 的 $sourceKey 精确映射到 $color，alpha 保持原值', ({ sourceKey, sourceColumn, color }) => {
    const targetHex = MASCOT_COLORS[color]?.hex || color.toLowerCase()
    const result = createMascotColorMatrix(sourceColumn, color)
    expect(result.color).toBe(targetHex)
    const transformed = applyMatrix(result, [...rgb(MASCOT_COLORS[sourceKey].hex), 0.37])
    rgb(targetHex).forEach((expected, channel) => expect(transformed[channel]).toBeCloseTo(expected, 10))
    expect(transformed[3]).toBe(0.37)
  })

  it.each(columnKeys)('改变 %s 主体时保留黑、白、灰及透明边缘的 alpha', sourceKey => {
    const result = createMascotColorMatrix(columnKeys.indexOf(sourceKey), '#12abef')
    for (const gray of [0, 0.15, 0.5, 1]) {
      for (const alpha of [0, 0.35, 1]) {
        const transformed = applyMatrix(result, [gray, gray, gray, alpha])
        transformed.slice(0, 3).forEach(value => expect(value).toBeCloseTo(gray, 10))
        expect(transformed[3]).toBe(alpha)
      }
    }
  })

  it.each(columnKeys)('%s 的主体明暗渐变沿同一灰轴映射，不压成单一平面色', sourceKey => {
    const source = rgb(MASCOT_COLORS[sourceKey].hex)
    const target = rgb('#248bd1')
    const result = createMascotColorMatrix(columnKeys.indexOf(sourceKey), '#248bd1')
    for (const [bodyWeight, gray] of [[0.8, 0], [0.6, 0.15], [0.25, 0.5]]) {
      const pixel = source.map(value => value * bodyWeight + gray)
      const transformed = applyMatrix(result, [...pixel, 0.8])
      target.forEach((value, channel) => expect(transformed[channel]).toBeCloseTo(value * bodyWeight + gray, 10))
      expect(transformed[3]).toBe(0.8)
    }
  })

  it('预设名及六位 RGB 可规范化，输出颜色始终为小写六位 hex', () => {
    expect(createMascotColorMatrix(0, '  YELLOW  ').color).toBe(MASCOT_COLORS.yellow.hex)
    expect(createMascotColorMatrix(0, '  #12ABef  ').color).toBe('#12abef')
  })

  it('同色的预设或不同大小写 hex 都安全省略 filter', () => {
    columnKeys.forEach((key, column) => {
      expect(createMascotColorMatrix(column, key)).toBeNull()
      expect(createMascotColorMatrix(column, ` ${MASCOT_COLORS[key].hex.toUpperCase()} `)).toBeNull()
    })
  })

  it('无效源列不抛异常或产生不可用的矩阵', () => {
    for (const column of [undefined, null, -1, 4, 0.5, '1', NaN, Infinity, true, {}, Symbol('column')]) {
      expect(createMascotColorMatrix(column, 'pink')).toBeNull()
    }
  })

  it('拒绝非颜色值、缩写、alpha hex、CSS 表达式和原型同名输入', () => {
    for (const color of [undefined, null, '', ' ', '#abc', '#12345678', '123456', '#gg0000', 'rgb(1,2,3)', 'var(--color)', 'unknown', '__proto__', 'constructor', 'toString', 123, {}, Symbol('color')]) {
      expect(createMascotColorMatrix(0, color)).toBeNull()
    }
  })
})
