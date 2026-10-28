import { useNavigate } from 'react-router-dom'
import { AppShell, EmptyState } from '../components/ui'
import { EmptyLost } from '../components/illustrations/EmptyArts'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <AppShell style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <EmptyState
        illustration={<EmptyLost />}
        title="页面不存在或已被移除"
        actionLabel="返回首页"
        onAction={() => navigate('/', { replace: true })}
      />
    </AppShell>
  )
}
