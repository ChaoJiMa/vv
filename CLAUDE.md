# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

邻里互助小程序，全部代码位于 `neighbor-help/` 下，分两个独立部署单元：

- `neighbor-help/worker/` — Cloudflare Workers 后端 + D1 (SQLite) 数据库
- `neighbor-help/frontend/` — React 19 + Vite 前端 (部署到 Cloudflare Pages)

两者无共享构建配置，各自有独立的 `package.json`，需分别 `cd` 进目录操作。

## 常用命令

### 后端 (worker/)
```bash
cd neighbor-help/worker
npx wrangler dev                                          # 本地开发，监听 localhost:8787
npx wrangler d1 execute neighbor-help-db --file=schema.sql # 应用 schema（远端加 --remote）
npx wrangler d1 execute neighbor-help-db --command="SELECT * FROM users"  # 即席查询
npx wrangler deploy                                       # 部署
```

### 前端 (frontend/)
```bash
cd neighbor-help/frontend
npm run dev      # Vite 开发服务器（默认 5173）
npm run lint     # ESLint 检查全项目
npm run build    # 产物输出到 dist/
npx wrangler pages deploy dist   # 部署
```

无测试套件（worker 的 `npm test` 是占位符）。

## 本地开发约定

- 前端通过 `vite.config.js` 的 proxy 把 `/api` 和 `/auth` 转发到 `http://localhost:8787`，所以本地开发时**两个服务都要起**，且前端不需要设置 `VITE_API_URL`（留空走 proxy）。
- 后端密钥放在 `worker/.dev.vars`（本地，git 忽略）；生产环境用 Cloudflare Dashboard 的 Workers 环境变量。所需变量：`JWT_SECRET`（必需）、`WX_APPID` / `WX_SECRET`（微信登录用，可选）。
- 修改 `schema.sql` 后需手动重新执行 `wrangler d1 execute` 才会生效，没有迁移机制。

## 架构要点

### 后端请求流（无框架，纯手写路由）
`worker/src/index.js` 是唯一入口：统一注入 CORS 头、处理 OPTIONS 预检、try/catch 兜底返回 500，然后按路径前缀分发：
- `/auth/*` → `auth.js` 的 `handleAuth`
- `/api/*` → `posts.js` 的 `handlePosts`

`handlePosts` 内部用 `pathname.split('/')` 的 parts 数组做手动路由匹配（如 `parts[1] === 'posts' && parts[3] === 'comments'`），没有路由库。新增接口就在这两个 handler 里加 if 分支。

### 认证（`auth.js`，全部基于 Web Crypto，不依赖 Node 库）
- 密码：PBKDF2-SHA256（10 万次迭代），存储格式 `salt:hash`（均为 hex），见 `hashPassword`/`verifyPassword`。
- Token：自实现 HS256 JWT（`signJWT`/`verifyJWT`），30 天过期，**用 `Date.now()` 毫秒时间戳**作 `exp`（非标准 JWT 的秒）。
- 受保护接口在 handler 里调用 `verifyAuth(request, env)`，返回 `null` 即未授权 → `unauth(headers)`。
- 用户表同时支持用户名密码和微信 openid 两种身份（`users.username` 与 `users.openid` 均可空且唯一）。

### 数据模型（`schema.sql`）
三张表：`users`、`posts`、`comments`。`posts.type` 区分四类业务（求助互助/闲置转让/失物招领/拼单拼团），`posts.images` 存 JSON 字符串数组，`posts.status` 为 `open`/`closed`。列表与详情查询都 JOIN users 带出 nickname/building/unit。

### 前端
- `src/api.js` 是唯一的 HTTP 层：`request()` 自动附加 `Authorization: Bearer <token>`（token 存 localStorage），非 2xx 抛出 `Error(data.error)`。新增后端接口时在此处加方法。
- `src/hooks/useAuth.jsx` 提供 `AuthProvider` / `useAuth`，挂载时用本地 token 调 `getMe()` 恢复登录态，失败则清 token。
- 路由在 `App.jsx`：`/`、`/post/:id`、`/create`、`/login`，外层包裹 React Query 的 `QueryClientProvider`。
- 样式用 Tailwind（注意 `package.json` 同时存在 `@tailwindcss/vite` v4 与 `tailwindcss` v3，以实际 `tailwind.config.js` + postcss 配置为准）。
