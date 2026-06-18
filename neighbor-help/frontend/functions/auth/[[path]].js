// Pages Functions 反向代理:把 /auth/* 转发给独立部署的 Worker 后端。
// 说明见 functions/api/[[path]].js。
const WORKER = 'https://neighbor-help-worker.894905469.workers.dev'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  return fetch(new Request(WORKER + url.pathname + url.search, request))
}
