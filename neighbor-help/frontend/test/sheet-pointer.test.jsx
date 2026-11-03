import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sheet from '../src/components/ui/Sheet'

/** 真实挂载抽屉并响应关闭，验证指针捕获不会抢走头部控件的点击。 */
function SheetFixture({ onClose }) {
  const [open, setOpen] = useState(true)
  return (
    <Sheet open={open} title="测试面板" onClose={() => { onClose(); setOpen(false) }}>
      面板内容
    </Sheet>
  )
}

describe('sheet header pointer interactions', () => {
  let root, container, header, onClose, capture

  // jsdom 没有原生 PointerEvent；补充 pointerId 后仍走真实 DOM 冒泡与 React 指针处理。
  function pointer(target, type, clientY) {
    const event = new MouseEvent(type, { bubbles: true, clientY })
    Object.defineProperty(event, 'pointerId', { value: 7 })
    target.dispatchEvent(event)
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    onClose = vi.fn()
    capture = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<SheetFixture onClose={onClose} />))
    await act(async () => vi.runAllTimers())
    header = document.querySelector('[role="dialog"]').firstElementChild
    header.setPointerCapture = capture
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lets the close control and its descendants receive clicks without starting a drag', async () => {
    const closeButton = header.querySelector('button[aria-label="关闭"]')
    const glyph = document.createElement('span')
    closeButton.append(glyph)
    await act(async () => {
      pointer(glyph, 'pointerdown', 10)
      pointer(header, 'pointermove', 140)
      pointer(header, 'pointerup', 140)
    })
    expect(capture).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => closeButton.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(280))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each(['header', 'handle'])('still captures a drag from the non-interactive %s and closes past the threshold', async (start) => {
    const target = start === 'handle' ? header.firstElementChild : header
    await act(async () => {
      pointer(target, 'pointerdown', 10)
      pointer(header, 'pointermove', 140)
      pointer(header, 'pointerup', 140)
    })
    expect(capture).toHaveBeenCalledExactlyOnceWith(7)
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(280))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
