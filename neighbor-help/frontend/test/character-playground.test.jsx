import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterPlayground from '../src/dev/CharacterPlayground'
import { MASCOT_COLORS } from '../src/utils/mascotColor'

// 只替换装饰图形的绘制，读取真实状态参数；预览控件与素材名称继续使用实际页面代码。
vi.mock('../src/components/icons/GummyCharacter', () => ({ default: ({ expression, color, size }) => (
  <span data-expression={expression} data-color={color} data-size={size} />
) }))

/** 角色组合是纯本地预览：测试两组选择相互独立、自选颜色持久以及不触发网络请求。 */
describe('character combination playground', () => {
  let root, container, fetchMock
  const preview = () => container.querySelector('figure [data-expression]')
  async function click(label) {
    const button = [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label)
    expect(button, label).toBeTruthy()
    await act(async () => button.click())
  }
  const colorLabel = key => `${MASCOT_COLORS[key].label}配色`

  beforeEach(async () => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<CharacterPlayground />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('starts with the first expression in pink and shows all real expression choices without API calls', () => {
    expect(preview().dataset.expression).toBe('0')
    expect(preview().dataset.color).toBe('pink')
    expect(container.querySelectorAll('.nh-character-playground-expressions button')).toHaveLength(12)
    expect(container.querySelector('a').getAttribute('href')).toBe('/')
    expect(container.textContent).toContain('12种形象 × 4种基础配色，支持自选颜色')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('changes a preset color without resetting the selected expression', async () => {
    await click('思考小软块')
    await click(colorLabel('blue'))
    expect(preview().dataset.expression).toBe('7')
    expect(preview().dataset.color).toBe('blue')
    expect(container.querySelector('button[aria-label="思考小软块"]').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector(`button[aria-label="${colorLabel('blue')}"]`).getAttribute('aria-pressed')).toBe('true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('changes the expression while retaining its previously chosen preset color', async () => {
    await click(colorLabel('lilac'))
    await click('两位小邻居')
    expect(preview().dataset.expression).toBe('11')
    expect(preview().dataset.color).toBe('lilac')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a custom color across expression changes and never changes the expression when choosing it', async () => {
    await click('仰望水滴')
    const custom = container.querySelector('input[aria-label="自定义颜色"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(custom, '#ab56cd')
      custom.dispatchEvent(new Event('input', { bubbles: true }))
      custom.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(preview().dataset.expression).toBe('9')
    expect(preview().dataset.color).toBe('#AB56CD')
    await click('好奇细水滴')
    expect(preview().dataset.expression).toBe('2')
    expect(preview().dataset.color).toBe('#AB56CD')
    expect([...container.querySelectorAll('.nh-character-playground-expressions [data-color]')].every(element => element.dataset.color === '#AB56CD')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
