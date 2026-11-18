/** 角色图集各列的主体基色；颜色选择独立于表情、分类和 UI 组件。 */
export const MASCOT_COLORS = {
  pink: { label: '粉色', hex: '#fc81c1' },
  yellow: { label: '奶黄', hex: '#fcd14a' },
  lilac: { label: '淡紫', hex: '#ca95fa' },
  blue: { label: '蓝色', hex: '#839efb' },
}

const SOURCE_COLUMNS = ['pink', 'yellow', 'lilac', 'blue']

/** 仅接受已知预设或六位 RGB，统一为小写；原型属性名和其他 CSS 颜色安全回退。 */
function parseColor(color) {
  if (typeof color !== 'string') return null
  const value = color.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(MASCOT_COLORS, value)) return MASCOT_COLORS[value].hex
  return /^#[0-9a-f]{6}$/.test(value) ? value : null
}

function toRgb(hex) {
  return [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
}

/**
 * 为图集源列生成 SVG feColorMatrix；返回规范颜色和 20 个系数，无效或同色时返回 null。
 * 调用方应设置 colorInterpolationFilters="sRGB"，使矩阵与这里的 RGB 基色使用同一空间。
 * hue-rotate 虽保持灰轴，但不能将任意源色精确映射到指定目标；整体 brightness 会改变灰阶和白眼。
 * 这里让 RGB 灰轴保持恒等，保留白眼、黑线，只沿源色差方向换色。
 * A = I + (T-S) outer v，v 与灰轴正交且 v·S=1，因此 S→T，任意灰色与透明度保持原值。
 * 源色叠加灰色形成的明暗渐变也随之映射，不重新绘制角色轮廓或修改图片 alpha。
 * @param {number} sourceColumn 图集源列，0粉色、1奶黄、2淡紫、3蓝色。
 * @param {string} color 预设 key 或 #RRGGBB，可带首尾空白。
 * @returns {{color: string, values: string} | null} 可直接交给 SVG 矩阵的滤镜参数。
 */
export function createMascotColorMatrix(sourceColumn, color) {
  if (!Number.isInteger(sourceColumn) || sourceColumn < 0 || sourceColumn >= SOURCE_COLUMNS.length) return null
  const targetHex = parseColor(color)
  const sourceHex = MASCOT_COLORS[SOURCE_COLUMNS[sourceColumn]].hex
  if (!targetHex || targetHex === sourceHex) return null

  const source = toRgb(sourceHex)
  const target = toRgb(targetHex)
  const mean = source.reduce((sum, value) => sum + value, 0) / 3
  const direction = source.map(value => value - mean)
  const normSquared = direction.reduce((sum, value) => sum + value * value, 0)
  // 当前四列均非灰色；仍守住退化输入，避免将 NaN/Infinity 传入浏览器滤镜。
  if (!Number.isFinite(normSquared) || normSquared <= Number.EPSILON) return null
  const vector = direction.map(value => value / normSquared)
  const values = []
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      values.push((row === column ? 1 : 0) + (target[row] - source[row]) * vector[column])
    }
    values.push(0, 0)
  }
  // SVG 每行依次为 R/G/B/A/常数项；alpha 独立透传，不为透明边缘引入不透明底色。
  values.push(0, 0, 0, 1, 0)
  if (!values.every(Number.isFinite)) return null
  return { color: targetHex, values: values.map(value => Number(value.toPrecision(12))).join(' ') }
}
