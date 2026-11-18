import { useState } from 'react'
import GummyCharacter from '../components/icons/GummyCharacter'
import AppShell from '../components/ui/AppShell'
import personas from '../assets/gummy-neighbors-personas.json'
import { MASCOT_COLORS } from '../utils/mascotColor'
import './CharacterPlayground.css'

// 直接使用真实图集的三行角色名称；扁平索引与 GummyCharacter 的 expression 参数一致。
const EXPRESSIONS = personas.variants.flatMap(row => row.characters.map((label, column) => ({
  index: row.index * 4 + column,
  label,
})))

/** 开发专用角色组合页：形象与配色独立选择，仅预览真实素材，不读写 API、账号或业务数据。 */
export default function CharacterPlayground() {
  const [expression, setExpression] = useState(0)
  const [color, setColor] = useState('pink')
  const selectedExpression = EXPRESSIONS.find(item => item.index === expression)
  const selectedPreset = MASCOT_COLORS[color]
  const selectedHex = selectedPreset?.hex || color
  const colorName = selectedPreset?.label || '自定义颜色'

  return (
    <AppShell className="nh-character-playground">
      <header className="nh-character-playground-header">
        <h1>角色组合</h1>
        <a href="/">回首页</a>
      </header>
      <p className="nh-character-playground-intro">12种形象 × 4种基础配色，支持自选颜色</p>

      <figure className="nh-character-playground-preview" aria-label="当前角色组合">
        <GummyCharacter expression={expression} color={color} size={160} style={{ '--gummy-scale': 1 }} />
        <figcaption aria-live="polite">
          <strong>{selectedExpression.label}</strong>
          <span>{colorName}</span>
        </figcaption>
      </figure>

      <section className="nh-character-playground-section" aria-labelledby="nh-character-color-title">
        <div className="nh-character-playground-section-heading">
          <h2 id="nh-character-color-title">配色</h2>
          <label className="nh-character-playground-custom">
            <span>自定义</span>
            <input
              type="color"
              aria-label="自定义颜色"
              value={selectedHex}
              onChange={event => setColor(event.target.value.toUpperCase())}
            />
          </label>
        </div>
        <div className="nh-character-playground-colors">
          {Object.entries(MASCOT_COLORS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              aria-label={`${preset.label}配色`}
              aria-pressed={color === key}
              onClick={() => setColor(key)}
            >
              <span className="nh-character-playground-swatch" aria-hidden style={{ '--character-color': preset.hex }} />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="nh-character-playground-section" aria-labelledby="nh-character-expression-title">
        <h2 id="nh-character-expression-title">形象</h2>
        <div className="nh-character-playground-expressions">
          {EXPRESSIONS.map(item => (
            <button
              key={item.index}
              type="button"
              aria-label={item.label}
              aria-pressed={expression === item.index}
              onClick={() => setExpression(item.index)}
            >
              <GummyCharacter expression={item.index} color={color} size={48} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </section>
    </AppShell>
  )
}
