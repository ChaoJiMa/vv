import Button from './Button'

export default function ListError({ onRetry, message = '加载失败，请重试' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>{message}</p>
      <Button type="button" variant="secondary" onClick={onRetry}>重试</Button>
    </div>
  )
}
