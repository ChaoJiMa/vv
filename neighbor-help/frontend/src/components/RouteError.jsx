import AppShell from './ui/AppShell'
import EmptyState from './ui/EmptyState'

/** 数据路由的加载/渲染错误出口，保留统一恢复入口，避免显示框架默认异常堆栈。 */
export default function RouteError() {
  return (
    <AppShell>
      <EmptyState
        title="页面暂时无法打开"
        description="请刷新重试，或稍后再来。"
        actionLabel="刷新页面"
        onAction={() => window.location.reload()}
      />
    </AppShell>
  )
}
