import { useNavigate } from 'react-router-dom'
import { AppShell, EmptyState } from '../components/ui'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <AppShell style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 72, fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1, marginBottom: 8 }}>404</div>
      <EmptyState
        emoji=""
        title="页面不存在或已被移除"
        actionLabel="返回首页"
        onAction={() => navigate('/', { replace: true })}
      />
    </AppShell>
  )
}
