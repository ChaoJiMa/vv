import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RegistrationForm from '../src/pages/RegistrationForm'
import { api } from '../src/api'

vi.mock('../src/api', () => ({ api: { register: vi.fn(), getRegistrationOptions: vi.fn() } }))
// Node 无法解析 MUI 9 的过渡依赖目录入口；只替换 Drawer 动画外壳，协议正文与关闭按钮仍真实挂载。
vi.mock('@mui/material/Drawer', () => ({ default: ({ open, children, slotProps, className }) => open ? (
  <div role="dialog" aria-labelledby={slotProps.paper['aria-labelledby']} className={className}>{children}</div>
) : null }))

/** 挂载真实注册表单及协议抽屉，用本地 mock 验证实际提交、焦点和异步生命周期，不访问生产接口。 */
describe('registration form flow', () => {
  const user = { id: 'fixture-user', nickname: '邻居' }
  const password = 'fixture-pass123'
  let root, container, onSuccess, onLogin, onBusyChange

  function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  async function mount() {
    await act(async () => root.render(<RegistrationForm onSuccess={onSuccess} onLogin={onLogin} onBusyChange={onBusyChange} />))
  }
  function input(name) { return container.querySelector(`input[name="${name}"]`) }
  async function fill(name, value) {
    const element = input(name)
    expect(element).toBeTruthy()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function validFields() {
    await fill('username', 'Neighbor01')
    await fill('password', password)
    await fill('passwordConfirm', password)
  }
  function submitEvent() { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
  async function submit() { await act(async () => submitEvent()) }
  async function click(text) {
    const button = [...document.body.querySelectorAll('button')].find(element => element.textContent.trim() === text || element.getAttribute('aria-label') === text)
    expect(button, text).toBeTruthy()
    await act(async () => button.click())
  }

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    api.getRegistrationOptions.mockResolvedValue({ inviteCodeSupported: true })
    api.register.mockResolvedValue({ token: 'fixture-session', user })
    onSuccess = vi.fn()
    onLogin = vi.fn()
    onBusyChange = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('registers and logs in with an empty optional invitation, without sending profile or confirmation fields', async () => {
    await mount()
    await validFields()
    await submit()
    expect(api.register).toHaveBeenCalledExactlyOnceWith({ username: 'Neighbor01', password }, { silentError: true })
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('fixture-session', user)
    expect(onBusyChange.mock.calls.map(call => call[0])).toEqual([true, false])
    expect(container.querySelectorAll('input')).toHaveLength(4)
  })

  it('normalizes a supported invitation and submits the actual code', async () => {
    await mount()
    await validFields()
    await fill('inviteCode', ' ab12xy ')
    await act(async () => { input('inviteCode').focus(); input('inviteCode').blur() })
    expect(input('inviteCode').value).toBe('AB12XY')
    await submit()
    expect(api.register).toHaveBeenCalledExactlyOnceWith({ username: 'Neighbor01', password, inviteCode: 'AB12XY' }, { silentError: true })
  })

  it('reveals errors on blur and focuses the first invalid field on submit', async () => {
    await mount()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await fill('username', 'a-')
    await act(async () => { input('username').focus(); input('username').blur() })
    expect(container.textContent).toContain('账号需为4–20位字母或数字')
    await submit()
    expect(document.activeElement).toBe(input('username'))
    expect(container.textContent).toContain('请设置密码')
    expect(container.textContent).toContain('请再次输入密码')
    expect(api.register).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords and invalid invitations without sending a request', async () => {
    await mount()
    await validFields()
    await fill('passwordConfirm', 'a-different-password')
    await fill('inviteCode', 'bad-code')
    await submit()
    expect(document.activeElement).toBe(input('passwordConfirm'))
    expect(container.textContent).toContain('两次输入的密码不一致')
    expect(container.textContent).toContain('邀请码需为4–20位字母或数字')
    expect(api.register).not.toHaveBeenCalled()
  })

  it('blocks an unsupported invitation but allows clearing it to continue', async () => {
    api.getRegistrationOptions.mockResolvedValue({ inviteCodeSupported: false })
    await mount()
    await validFields()
    await fill('inviteCode', 'ABCD')
    await submit()
    expect(api.register).not.toHaveBeenCalled()
    expect(container.textContent).toContain('邀请码暂不可用，可清空后继续注册')
    expect(document.activeElement).toBe(input('inviteCode'))
    await fill('inviteCode', '')
    await submit()
    expect(api.register).toHaveBeenCalledExactlyOnceWith({ username: 'Neighbor01', password }, { silentError: true })
  })

  it('can retry invitation capability after loading fails for a nonempty code', async () => {
    api.getRegistrationOptions.mockRejectedValue(new TypeError('offline'))
    await mount()
    await validFields()
    await fill('inviteCode', 'ABCD')
    await submit()
    expect(api.register).not.toHaveBeenCalled()
    api.getRegistrationOptions.mockResolvedValue({ inviteCodeSupported: true })
    await click('重新检查邀请码')
    await submit()
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ inviteCode: 'ABCD' }), { silentError: true })
  })

  it('does not wait for invitation capability when submitting without a code', async () => {
    const options = deferred()
    api.getRegistrationOptions.mockReturnValue(options.promise)
    await mount()
    await validFields()
    await submit()
    expect(onSuccess).toHaveBeenCalledTimes(1)
    await act(async () => options.resolve({ inviteCodeSupported: false }))
  })

  it('does not start registration when another tab changes the session during invitation capability loading', async () => {
    const options = deferred()
    api.getRegistrationOptions.mockReturnValue(options.promise)
    await mount()
    await validFields()
    await fill('inviteCode', 'ABCD')
    await submit()
    expect(api.register).not.toHaveBeenCalled()
    await act(async () => {
      localStorage.setItem('token', 'another-fixture-session')
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: 'another-fixture-session' }))
      options.resolve({ inviteCodeSupported: true })
    })
    expect(api.register).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(onBusyChange.mock.calls.map(call => call[0])).toEqual([true, false])
  })

  it('does not restore a stale invitation error after clearing the code during a retry', async () => {
    api.getRegistrationOptions.mockResolvedValue({ inviteCodeSupported: false })
    await mount()
    await validFields()
    await fill('inviteCode', 'ABCD')
    await submit()
    expect(container.textContent).toContain('邀请码暂不可用，可清空后继续注册')
    const retry = deferred()
    api.getRegistrationOptions.mockReturnValueOnce(retry.promise)
    await click('重新检查邀请码')
    const retryButton = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '重新检查邀请码')
    expect(retryButton.disabled).toBe(true)
    expect(retryButton.getAttribute('aria-busy')).toBe('true')
    const calls = api.getRegistrationOptions.mock.calls.length
    await act(async () => retryButton.click())
    expect(api.getRegistrationOptions).toHaveBeenCalledTimes(calls)
    await fill('inviteCode', '')
    await act(async () => retry.resolve({ inviteCodeSupported: false }))
    expect(input('inviteCode').getAttribute('aria-invalid')).toBe('false')
    expect(container.textContent).not.toContain('邀请码暂不可用，可清空后继续注册')
    await submit()
    expect(api.register).toHaveBeenCalledExactlyOnceWith({ username: 'Neighbor01', password }, { silentError: true })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it.each([1001, 409])('shows an occupied-account error beside the account, retains inputs and clears it after editing (%s)', async (code) => {
    api.register.mockRejectedValue(Object.assign(new Error('账号已被注册'), { code }))
    await mount()
    await validFields()
    await submit()
    const errorId = input('username').getAttribute('aria-describedby').split(' ').find(value => value.endsWith('-error'))
    expect(document.getElementById(errorId).textContent).toBe('账号已被注册')
    expect(document.activeElement).toBe(input('username'))
    expect(input('username').value).toBe('Neighbor01')
    expect(input('password').value).toBe(password)
    expect(input('passwordConfirm').value).toBe(password)
    expect(onSuccess).not.toHaveBeenCalled()
    await fill('username', 'Neighbor02')
    expect(input('username').getAttribute('aria-invalid')).toBe('false')
    expect(container.textContent).not.toContain('账号已被注册')
  })

  it.each([
    [Object.assign(new Error('服务暂时不可用'), { code: 500 }), '服务暂时不可用'],
    [new TypeError('offline'), '网络暂时不可用，请检查后重试'],
  ])('keeps inputs and shows registration failures inside the form (%s)', async (error, message) => {
    api.getRegistrationOptions.mockRejectedValue(new TypeError('options offline'))
    api.register.mockRejectedValue(error)
    await mount()
    await validFields()
    await submit()
    expect(api.register).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]').textContent).toBe(message)
    expect(input('password').value).toBe(password)
    expect(input('username').matches(':disabled')).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('locks all controls and prevents duplicate submissions before React can rerender', async () => {
    const pending = deferred()
    api.register.mockReturnValue(pending.promise)
    await mount()
    await validFields()
    await act(async () => { submitEvent(); submitEvent() })
    expect(api.register).toHaveBeenCalledTimes(1)
    expect(input('username').matches(':disabled')).toBe(true)
    await click('去登录')
    expect(onLogin).not.toHaveBeenCalled()
    expect(onBusyChange).toHaveBeenCalledExactlyOnceWith(true)
    await act(async () => pending.resolve({ token: 'fixture-session', user }))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onBusyChange.mock.calls.map(call => call[0])).toEqual([true, false])
  })

  it('releases parent busy state when unmounted and ignores a late successful registration', async () => {
    const pending = deferred()
    api.register.mockReturnValue(pending.promise)
    await mount()
    await validFields()
    await submit()
    await act(async () => root.unmount())
    root = null
    expect(onBusyChange.mock.calls.map(call => call[0])).toEqual([true, false])
    await act(async () => pending.resolve({ token: 'fixture-session', user }))
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onBusyChange).toHaveBeenCalledTimes(2)
  })

  it('silently ignores a registration rejected after the session changed', async () => {
    api.register.mockRejectedValue(Object.assign(new Error('登录状态已改变，请重试'), { name: 'StaleSessionError' }))
    await mount()
    await validFields()
    await submit()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(input('username').value).toBe('Neighbor01')
  })

  it('preserves password-manager semantics and lets each password be revealed independently', async () => {
    await mount()
    await validFields()
    expect(input('username').autocomplete).toBe('username')
    expect(input('password').autocomplete).toBe('new-password')
    expect(input('passwordConfirm').autocomplete).toBe('new-password')
    await click('显示密码')
    expect(input('password').type).toBe('text')
    expect(input('passwordConfirm').type).toBe('password')
    expect(input('password').value).toBe(password)
    await click('显示确认密码')
    expect(input('passwordConfirm').type).toBe('text')
    await click('隐藏密码')
    expect(input('password').type).toBe('password')
  })

  it('opens readable policies and offers returning to login without submitting', async () => {
    await mount()
    await click('《用户协议》')
    expect(document.body.textContent).toContain('目前没有居住或社区身份核验流程')
    expect(document.body.textContent).toContain('邀请码可以留空')
    await click('关闭')
    await click('《隐私政策》')
    expect(document.body.textContent).toContain('后端保存密码哈希用于登录校验')
    expect(document.body.textContent).toContain('新版本公开资料')
    expect(document.body.textContent).toContain('你填写的帖子地点、正文和评论会向其他用户展示')
    await click('关闭')
    await click('去登录')
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(api.register).not.toHaveBeenCalled()
  })
})
