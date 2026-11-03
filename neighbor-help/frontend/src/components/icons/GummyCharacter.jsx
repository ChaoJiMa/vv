import { useId } from 'react'
import gummyAtlas from '../../assets/gummy-neighbors-personas.webp'
import { MASCOT_COLORS, createMascotColorMatrix } from '../../utils/mascotColor'
import CategoryIcon from './CategoryIcon'
import Svg from './svg'
import './gummy-character.css'

// 真实图集按四列三行排列；每格映射到外壳的 24×24 坐标，不重画人物。
const SPRITE_COLUMNS = {
  help: 0,
  idle: 1,
  lost: 2,
  group: 3,
}
const TYPE_COLORS = { help: 'pink', idle: 'yellow', lost: 'lilac', group: 'blue' }
// 保留已有页面的默认行；形象由调用参数决定，不按时间随机变化。
const DEFAULT_VARIANTS = { help: 0, idle: 2, lost: 1, group: 2 }

/**
 * 分类装饰角色：内嵌真实 WebP 图集并裁出单格，保留既有 SVG 外壳、图标属性和占位。
 * expression 可指定 0..11 的任意形象，优先于兼容参数 variant（0..2 行）；非法值使用分类默认。
 * color 接受预设名或 #RRGGBB，默认沿用 type 分类色；跨列换形象时也保持目标分类配色。
 * 换色只应用于有真实图像边界的 image，矩阵由 helper 保证黑白、灰色与 alpha 保持原值。
 * size/className/style 继续交给原外壳处理；默认不进入焦点或读屏顺序。
 * 未知分类回退功能线标，避免菜单扩展后出现空白；分类含义始终由调用方文字表达。
 */
export default function GummyCharacter({ type = 'help', variant, expression, color, size = 48, className = '', style, ...rest }) {
  // 必须先执行 Hook；同一实例从已知分类切到未知分类时，仍保持相同的 Hook 顺序。
  const instanceId = useId()
  // 使用旧版 Safari 也支持的属性检查，避免装饰角色阻断整个页面渲染。
  if (!Object.prototype.hasOwnProperty.call(SPRITE_COLUMNS, type)) {
    return <CategoryIcon type={type} size={size} className={className} style={style} {...rest} />
  }
  const variantIndex = Number.isInteger(variant) && variant >= 0 && variant <= 2 ? variant : DEFAULT_VARIANTS[type]
  const expressionIndex = Number.isInteger(expression) && expression >= 0 && expression <= 11
    ? expression
    : variantIndex * 4 + SPRITE_COLUMNS[type]
  const column = expressionIndex % 4
  const row = Math.floor(expressionIndex / 4)

  // helper 的 null 也可能表示同色无需滤镜，因此先独立规范颜色供 data 属性和默认回退使用。
  const colorValue = typeof color === 'string' ? color.trim().toLowerCase() : ''
  const requestedColor = Object.prototype.hasOwnProperty.call(MASCOT_COLORS, colorValue)
    ? MASCOT_COLORS[colorValue].hex
    : (/^#[0-9a-f]{6}$/.test(colorValue) ? colorValue : null)
  const targetColor = requestedColor || MASCOT_COLORS[TYPE_COLORS[type]].hex
  const matrix = createMascotColorMatrix(column, targetColor)
  const clipId = `${instanceId}-clip`
  const filterId = `${instanceId}-color`

  return (
    <Svg
      size={size}
      className={`nh-gummy-character ${className}`.trim()}
      data-gummy-type={type}
      data-gummy-variant={row}
      data-gummy-expression={expressionIndex}
      data-gummy-color={targetColor}
      style={{ ...style }}
      {...rest}
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x="0" y="0" width="24" height="24" fill="white" stroke="none" />
        </clipPath>
        {matrix ? (
          <filter id={filterId} filterUnits="userSpaceOnUse" x="0" y="0" width="24" height="24" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={matrix.values} />
          </filter>
        ) : null}
      </defs>
      <image
        href={gummyAtlas}
        x={-column * 24}
        y={-row * 24}
        width="96"
        height="72"
        preserveAspectRatio="none"
        clipPath={`url(#${clipId})`}
        filter={matrix ? `url(#${filterId})` : undefined}
      />
    </Svg>
  )
}
