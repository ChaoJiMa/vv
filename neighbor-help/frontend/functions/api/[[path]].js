// Pages Functions 反向代理:把 /api/* 转发给独立部署的 Worker 后端。
// 目的:国内浏览器直连 *.workers.dev 常被墙,但可访问 Pages 主域;
// Pages 边缘到 Worker 是 Cloudflare 内网请求,不经过 GFW,稳定可达。
// 这样前端只需同源访问 /api,跨域与可达性问题一并消除。
const WORKER = 'https://neighbor-help-worker.894905469.workers.dev'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  // 原样转发 method/headers/body 到 Worker,保留路径与查询串
  return fetch(new Request(WORKER + url.pathname + url.search, request))
}
