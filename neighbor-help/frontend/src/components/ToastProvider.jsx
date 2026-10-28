import { useEffect, useState } from 'react'
import { toast } from '../toast'

// 订阅全局 toast 单例；样式吃设计 token，适配明暗主题
export default function ToastProvider() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ message: '', severity: 'error' })

  useEffect(() => {
    return toast.subscribe(({ message, severity }) => {
      setState({ message, severity })
      setOpen(true)
    })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => setOpen(false), 3000)
    return () => clearTimeout(t)
  }, [open, state])

  if (!open) return null

  const palette = {
    success: { background: 'var(--color-primary)', color: 'var(--color-on-primary)' },
    info: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    error: { background: 'var(--color-danger)', color: '#fff' },
  }[state.severity] || { background: 'var(--color-surface)', color: 'var(--color-text)' }

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 'calc(12px + env(safe-area-inset-top))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        maxWidth: 'min(420px, calc(100vw - 32px))',
        padding: '12px 16px',
        borderRadius: 14,
        boxShadow: 'var(--shadow-card)',
        fontSize: 14,
        fontWeight: 600,
        textAlign: 'center',
        lineHeight: 1.4,
        ...palette,
      }}
      onClick={() => setOpen(false)}
    >
      {state.message}
    </div>
  )
}
