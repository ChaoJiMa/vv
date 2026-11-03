import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useDisplayFont from '../src/hooks/useDisplayFont'
import PageTitle from '../src/components/ui/PageTitle'
import HomeTop from '../src/components/home/HomeTop'

/** 通过真实 Hook 挂载验证字体 Promise 与超时的竞争，不加载网络字体或依赖视觉快照。 */
describe('display font readiness gate', () => {
  const fallback = 'system-ui, sans-serif'
  const display = '"KaiXinTi", system-ui, sans-serif'
  let root, container, load, originalFonts

  function Probe() {
    const { ready, fontFamily } = useDisplayFont()
    return <output data-ready={String(ready)}>{fontFamily}</output>
  }
  function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  async function mount() { await act(async () => root.render(<Probe />)) }
  function output() { return container.querySelector('output') }
  function expectReady(fontFamily) {
    expect(output().dataset.ready).toBe('true')
    expect(output().textContent).toBe(fontFamily)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
    load = vi.fn()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    container.remove()
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else delete document.fonts
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('waits for the complete display text and selects the font only when faces finish loading', async () => {
    const pending = deferred()
    load.mockReturnValue(pending.promise)
    await mount()
    expect(load).toHaveBeenCalledExactlyOnceWith('40px "KaiXinTi"', '邻里里 · 远亲不如近邻 欢迎成为新邻居 和身边的邻居，互相搭把手 发现 聊天 消息 首页')
    expect(output().dataset.ready).toBe('false')
    await act(async () => vi.advanceTimersByTime(1499))
    expect(output().dataset.ready).toBe('false')
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    expectReady(display)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses an already resolved font immediately without an extra timer delay', async () => {
    load.mockResolvedValue([{ family: 'KaiXinTi' }])
    await mount()
    expectReady(display)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back when the font request rejects', async () => {
    load.mockRejectedValue(new Error('font unavailable'))
    await mount()
    expectReady(fallback)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([undefined, {}])('falls back when the font-loading API is missing (%j)', async fonts => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    await mount()
    expectReady(fallback)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back when no matching font faces are returned', async () => {
    load.mockResolvedValue([])
    await mount()
    expectReady(fallback)
  })

  it('falls back if the font API throws synchronously', async () => {
    load.mockImplementation(() => { throw new Error('font API unavailable') })
    await mount()
    expectReady(fallback)
  })

  it('keeps the fallback after the 1500ms deadline even if the font resolves later', async () => {
    const pending = deferred()
    load.mockReturnValue(pending.promise)
    await mount()
    await act(async () => vi.advanceTimersByTime(1500))
    expectReady(fallback)
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    expectReady(fallback)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its deadline on unmount and ignores the pending font result', async () => {
    const pending = deferred()
    load.mockReturnValue(pending.promise)
    await mount()
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => root.unmount())
    root = null
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    expect(container.textContent).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gates only page title text while keeping the doodle and neighboring action available', async () => {
    const pending = deferred()
    load.mockReturnValue(pending.promise)
    await act(async () => root.render(<><PageTitle>发现</PageTitle><button type="button">搜索</button></>))
    const text = container.querySelector('.nh-page-title-text')
    expect(text.style.visibility).toBe('hidden')
    expect(container.querySelector('.nh-title-doodle')).toBeTruthy()
    expect(container.querySelector('button').disabled).toBe(false)
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    expect(text.style.visibility).toBe('visible')
    expect(text.style.fontFamily).toBe(display)
  })

  it('keeps a page title on the explicit system fallback after timeout and a late font response', async () => {
    const pending = deferred()
    load.mockReturnValue(pending.promise)
    await act(async () => root.render(<PageTitle>聊天</PageTitle>))
    await act(async () => vi.advanceTimersByTime(1500))
    const text = container.querySelector('.nh-page-title-text')
    expect(text.style.visibility).toBe('visible')
    expect(text.style.fontFamily).toBe(fallback)
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    expect(text.style.fontFamily).toBe(fallback)
  })

  it('waits for the home wordmark font while keeping the greeting and announcement usable', async () => {
    const pending = deferred()
    const openNotice = vi.fn()
    load.mockReturnValue(pending.promise)
    await act(async () => root.render(<HomeTop noticeSummary="查看社区公告" onNoticeClick={openNotice} />))
    const text = container.querySelector('.nh-home-wordmark')
    expect(text.style.visibility).toBe('hidden')
    expect(container.querySelector('.nh-title-doodle')).toBeTruthy()
    expect(container.textContent).toContain('邻居')
    await act(async () => container.querySelector('button').click())
    expect(openNotice).toHaveBeenCalledOnce()
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    expect(text.style.visibility).toBe('visible')
    expect(text.style.fontFamily).toBe(display)
  })

  it('keeps both the home wordmark and page title on fallback after a late font response', async () => {
    const pending = deferred()
    load.mockReturnValue(pending.promise)
    await act(async () => root.render(<><HomeTop /><PageTitle>发现</PageTitle></>))
    await act(async () => vi.advanceTimersByTime(1500))
    const texts = container.querySelectorAll('.nh-home-wordmark, .nh-page-title-text')
    expect(texts).toHaveLength(2)
    for (const text of texts) {
      expect(text.style.visibility).toBe('visible')
      expect(text.style.fontFamily).toBe(fallback)
    }
    await act(async () => pending.resolve([{ family: 'KaiXinTi' }]))
    for (const text of texts) expect(text.style.fontFamily).toBe(fallback)
  })
})
