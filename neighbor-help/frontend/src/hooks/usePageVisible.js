import { useSyncExternalStore } from 'react'

// 页面可见性 hook:订阅 document.visibilitychange,返回当前标签页是否可见。
// 用于轮询节流——页面切到后台/锁屏时暂停轮询,省请求与流量,切回时由
// React Query 的 refetchOnWindowFocus 立即补一次。useSyncExternalStore 保证
// SSR/并发安全,且多个组件共享同一订阅。
function subscribe(callback) {
  document.addEventListener('visibilitychange', callback)
  return () => document.removeEventListener('visibilitychange', callback)
}

function getSnapshot() {
  return document.visibilityState === 'visible'
}

export function usePageVisible() {
  // 服务端无 document,getServerSnapshot 返回 true(可见)兜底
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}

// 轮询间隔助手:可见时按 ms 轮询,不可见返回 false(暂停)。
// 用法:refetchInterval: pollInterval(visible, 4000)
export function pollInterval(visible, ms) {
  return visible ? ms : false
}
