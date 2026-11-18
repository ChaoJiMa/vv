import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'
import { captureSession, assertSessionCurrent } from '../session'
import RegistrationPolicies from './RegistrationPolicies'
import './RegistrationForm.css'

const FIELD_ORDER = ['username', 'password', 'confirm', 'inviteCode']
const INVITE_UNAVAILABLE = '邀请码暂不可用，可清空后继续注册'

/** 本地校验与后端账号规则一致；密码不 trim，邀请码仅在提交时按 trim + 大写传输。 */
function validate(values) {
  const errors = {}
  const username = values.username.trim()
  if (!username) errors.username = '请填写账号'
  else if (!/^[a-zA-Z0-9]{4,20}$/.test(username)) errors.username = '账号需为4–20位字母或数字'
  if (!values.password) errors.password = '请设置密码'
  else if (values.password.length < 8 || values.password.length > 100) errors.password = '密码需为8–100位'
  if (!values.confirm) errors.confirm = '请再次输入密码'
  else if (values.confirm !== values.password) errors.confirm = '两次输入的密码不一致'
  const inviteCode = values.inviteCode.trim()
  if (inviteCode && !/^[a-zA-Z0-9]{4,20}$/.test(inviteCode)) errors.inviteCode = '邀请码需为4–20位字母或数字'
  return errors
}

/** 密码显隐保持独立按钮与原输入值；44px 点击区兼容触屏及密码管理器。 */
function PasswordToggle({ shown, label, onClick }) {
  return (
    <button className="nh-registration-eye" type="button" aria-label={`${shown ? '隐藏' : '显示'}${label}`} aria-pressed={shown} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.8" />
        {shown ? <path d="m4 3 16 18" /> : null}
      </svg>
    </button>
  )
}

/**
 * 同页四字段注册：只发送账号、密码和可用的可选邀请码，不收集住址或昵称。
 * ref 先锁住重复提交；卸载后忽略异步结果，登录与路由交给真实成功后的 onSuccess。
 */
export default function RegistrationForm({ onSuccess, onLogin, onBusyChange }) {
  const id = useId()
  const [values, setValues] = useState({ username: '', password: '', confirm: '', inviteCode: '' })
  const [touched, setTouched] = useState({})
  const [shown, setShown] = useState({ password: false, confirm: false })
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')
  const [usernameServerError, setUsernameServerError] = useState('')
  const [inviteStatus, setInviteStatus] = useState('loading')
  const [inviteUnavailable, setInviteUnavailable] = useState(false)
  const [policy, setPolicy] = useState(null)
  const inputs = useRef({})
  const active = useRef(false)
  const submitLock = useRef(false)
  const optionsRequest = useRef(null)
  const inviteRetryId = useRef(0)
  const busyCallback = useRef(onBusyChange)

  useEffect(() => { busyCallback.current = onBusyChange }, [onBusyChange])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      if (submitLock.current) busyCallback.current?.(false)
    }
  }, [])

  // 能力查询不要求登录，也不拦空邀请码；挂载和提交中的并发读取复用同一个请求。
  const readInviteOptions = useCallback(() => {
    if (optionsRequest.current) return optionsRequest.current
    const pending = Promise.resolve().then(() => api.getRegistrationOptions()).then(options => {
      const supported = options?.inviteCodeSupported === true
      if (active.current) setInviteStatus(supported ? 'supported' : 'unsupported')
      return supported
    }).catch(() => {
      if (active.current) setInviteStatus('error')
      return false
    }).finally(() => {
      if (optionsRequest.current === pending) optionsRequest.current = null
    })
    optionsRequest.current = pending
    return pending
  }, [])

  useEffect(() => { readInviteOptions() }, [readInviteOptions])

  // 网络结果回来后先解除 fieldset 禁用，再聚焦服务端指出的字段，避免 focus 被浏览器忽略。
  useEffect(() => {
    if (submitting) return
    if (usernameServerError) inputs.current.username?.focus()
    else if (inviteUnavailable) inputs.current.inviteCode?.focus()
  }, [submitting, usernameServerError, inviteUnavailable])

  const errors = { ...validate(values), ...(usernameServerError ? { username: usernameServerError } : {}) }
  const update = (name, value) => {
    setValues(previous => ({ ...previous, [name]: value }))
    setApiError('')
    if (name === 'username') setUsernameServerError('')
    if (name === 'inviteCode') {
      // 输入变更使旧重试失效，避免清空后被迟到的能力结果恢复成错误态。
      inviteRetryId.current++
      setInviteUnavailable(false)
    }
  }
  const blur = (name) => {
    setTouched(previous => ({ ...previous, [name]: true }))
    if (name === 'inviteCode') {
      setValues(previous => ({ ...previous, inviteCode: previous.inviteCode.trim().toUpperCase() }))
    }
  }
  const focus = name => inputs.current[name]?.focus()

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitLock.current) return
    setTouched(Object.fromEntries(FIELD_ORDER.map(name => [name, true])))
    setApiError('')
    const invalid = FIELD_ORDER.find(name => errors[name])
    if (invalid) { focus(invalid); return }

    const session = captureSession()
    submitLock.current = true
    setSubmitting(true)
    busyCallback.current?.(true)
    const inviteCode = values.inviteCode.trim().toUpperCase()
    try {
      if (inviteCode) {
        const supported = inviteStatus === 'supported' || await readInviteOptions()
        if (!active.current) return
        // 能力读取可能跨越账号切换；不能用新会话继续旧页面发起的注册。
        assertSessionCurrent(session)
        if (!supported) {
          setInviteUnavailable(true)
          focus('inviteCode')
          return
        }
      }
      const payload = { username: values.username.trim(), password: values.password }
      if (inviteCode) payload.inviteCode = inviteCode
      assertSessionCurrent(session)
      const { token, user } = await api.register(payload, { silentError: true })
      if (!active.current) return
      if (!token || !user) throw new Error('注册结果暂时无法确认，请稍后重试')
      onSuccess?.(token, user)
    } catch (error) {
      if (active.current && error?.name !== 'StaleSessionError') {
        if (error?.code === 1001 || error?.code === 409 || error?.status === 409) {
          setUsernameServerError(error.message || '这个账号已被注册，请换一个')
        } else {
          setApiError(error instanceof TypeError ? '网络暂时不可用，请检查后重试' : error?.message || '注册失败，请稍后重试')
        }
      }
    } finally {
      submitLock.current = false
      if (active.current) {
        setSubmitting(false)
        busyCallback.current?.(false)
      }
    }
  }

  const retryInviteOptions = async () => {
    const retryId = ++inviteRetryId.current
    setInviteStatus('loading')
    const supported = await readInviteOptions()
    if (active.current && retryId === inviteRetryId.current) {
      setInviteUnavailable(!supported && !!inputs.current.inviteCode?.value.trim())
    }
  }

  const field = (name, label, options = {}) => {
    const { password = false, helper, ...inputProps } = options
    const error = touched[name] && (errors[name] || (name === 'inviteCode' && inviteUnavailable ? INVITE_UNAVAILABLE : ''))
    const inputId = `${id}-${name}`
    return (
      <div className="nh-registration-field" key={name}>
        <label htmlFor={inputId}>{label}</label>
        <div className={`nh-registration-input-wrap${error ? ' nh-registration-input-wrap--error' : ''}`}>
          <input
            {...inputProps}
            id={inputId}
            name={name === 'confirm' ? 'passwordConfirm' : name}
            type={password && !shown[name] ? 'password' : 'text'}
            value={values[name]}
            ref={element => { inputs.current[name] = element }}
            onChange={event => update(name, event.target.value)}
            onBlur={() => blur(name)}
            aria-invalid={!!error}
            aria-describedby={`${inputId}-helper${error ? ` ${inputId}-error` : ''}`}
          />
          {password ? <PasswordToggle shown={shown[name]} label={name === 'confirm' ? '确认密码' : '密码'} onClick={() => {
            setShown(previous => ({ ...previous, [name]: !previous[name] }))
            focus(name)
          }} /> : null}
        </div>
        <span id={`${inputId}-helper`} className="nh-registration-hint">{helper}</span>
        {error ? <span id={`${inputId}-error`} className="nh-registration-error" role="alert">{error}</span> : null}
      </div>
    )
  }

  return (
    <>
      <form className="nh-registration" aria-label="注册账号" noValidate onSubmit={handleSubmit}>
        <p className="nh-registration-intro">设置账号密码即可加入，个人资料可稍后完善。</p>
        <fieldset disabled={submitting} aria-busy={submitting}>
          {field('username', '账号', { required: true, maxLength: 20, autoComplete: 'username', autoCapitalize: 'none', spellCheck: false, helper: '4–20位字母或数字，用于登录。' })}
          {field('password', '密码', { password: true, required: true, maxLength: 100, autoComplete: 'new-password', helper: '8–100位，请妥善保存。' })}
          {field('confirm', '确认密码', { password: true, required: true, maxLength: 100, autoComplete: 'new-password', helper: '再次输入相同的密码。' })}
          {field('inviteCode', '邀请码（选填）', { maxLength: 20, autoComplete: 'off', autoCapitalize: 'characters', spellCheck: false, helper: '可留空，仅用于记录邀请来源。' })}
          {values.inviteCode.trim() && (inviteStatus === 'error' || inviteUnavailable) ? (
            <button
              type="button"
              className="nh-registration-link nh-registration-retry"
              disabled={inviteStatus === 'loading'}
              aria-busy={inviteStatus === 'loading' || undefined}
              onClick={retryInviteOptions}
            >重新检查邀请码</button>
          ) : null}
          {apiError ? <p className="nh-registration-error nh-registration-api-error" role="alert">{apiError}</p> : null}
          <p className="nh-registration-policies">
            注册前请阅读
            <button type="button" className="nh-registration-link" onClick={() => setPolicy('terms')}>《用户协议》</button>
            和
            <button type="button" className="nh-registration-link" onClick={() => setPolicy('privacy')}>《隐私政策》</button>
          </p>
          <button className="nh-registration-submit" type="submit" disabled={submitting}>{submitting ? '注册中…' : '注册并登录'}</button>
          <p className="nh-registration-login">已有账号？<button className="nh-registration-link" type="button" onClick={onLogin}>去登录</button></p>
        </fieldset>
      </form>
      <RegistrationPolicies policy={policy} onClose={() => setPolicy(null)} />
    </>
  )
}
