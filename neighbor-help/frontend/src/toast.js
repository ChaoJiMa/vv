// 全局 toast 单例:模块级事件发射,使非组件代码(如 api.js 拦截器)也能弹出提示。
// UI 由 ToastProvider(MUI Snackbar)订阅渲染。
let listener = null

export const toast = {
  // ToastProvider 挂载时注册;返回取消注册函数
  subscribe(fn) {
    listener = fn
    return () => { if (listener === fn) listener = null }
  },
  show(message, severity = 'error') {
    if (listener) listener({ message, severity })
  },
  error(message) { this.show(message, 'error') },
  success(message) { this.show(message, 'success') },
  info(message) { this.show(message, 'info') },
}
