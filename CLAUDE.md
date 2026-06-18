# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

邻里互助小程序，全部代码位于 `neighbor-help/` 下，分两个独立部署单元：

- `neighbor-help/worker/` — Cloudflare Workers 后端（Hono 框架）+ D1 (SQLite) + R2（图片对象存储）
- `neighbor-help/frontend/` — React 19 + Vite 前端（部署到 Cloudflare Pages）

两者无共享构建配置，各自有独立的 `package.json`，需分别 `cd` 进目录操作。

## 常用命令

### 后端 (worker/)
```bash
cd neighbor-help/worker
npx wrangler dev                                   # 本地开发，监听 localhost:8787
npx wrangler d1 migrations apply neighbor-help-db  # 应用增量迁移（远端加 --remote）
npx wrangler d1 execute neighbor-help-db --command="SELECT * FROM users"  # 即席查询
npx wrangler deploy                                # 部署
npm test                                           # vitest（当前无用例）
```

### 前端 (frontend/)
```bash
cd neighbor-help/frontend
npm run dev      # Vite 开发服务器（默认 5173）
npm run lint     # ESLint 检查全项目
npm run build    # 产物输出到 dist/
npx wrangler pages deploy dist   # 部署
```

无实质测试用例（worker 配了 vitest 但无 `*.test.js`，前端无测试）。

## 本地开发约定

- 前端通过 `vite.config.js` 的 proxy 把 `/api` 和 `/auth` 转发到 `http://localhost:8787`，所以本地开发时**两个服务都要起**，且前端不需要设置 `VITE_API_URL`（留空走 proxy）。
- 后端密钥放在 `worker/.dev.vars`（本地，git 忽略）；生产环境用 Cloudflare Dashboard 的 Workers 环境变量。所需变量：`JWT_SECRET`（必需）、`WX_APPID` / `WX_SECRET`（微信登录用，可选）。
- 绑定见 `worker/wrangler.toml`：D1 绑定名 `DB`、R2 绑定名 `IMAGES`。
- 改库结构：在 `worker/migrations/` 新增 `000N_xxx.sql` 增量迁移并 `wrangler d1 migrations apply`。`worker/schema.sql` 只是「完整表结构参考快照」，**不是**建库来源——改表时要同步更新它与 migrations，避免漂移。

## 架构要点

### 后端请求流（Hono）
`worker/src/index.js` 是入口：注册 CORS（动态校验来源，含 Pages 预览子域名）+ 日志中间件 + `notFound`/`onError` 兜底，然后挂载子路由。**挂载顺序有讲究**：含公开路由的子应用（`posts` 的列表/详情、`images` 的 `GET /api/img`）必须挂在用 `use('*', authRequired)` 的鉴权子应用（`messages`/`reports`）**之前**，否则公开路由会被全局鉴权拦成 401。

路由文件在 `worker/src/routes/`，每个是独立 Hono 子应用：
- `auth.js` → `/auth/*`：注册、登录、微信登录
- `posts.js` → `/api/*`：菜单、小区结构、帖子 CRUD、评论、响应、采纳、个人资料/统计
- `images.js` → `/api/*`：图片上传（需登录）+ `GET /api/img/:key` 公开代理读图
- `messages.js` → `/api/*`：私信 + 通知（整个子应用 `authRequired`）
- `reports.js` → `/api/*`：举报（整个子应用 `authRequired`）

新增接口：在对应子应用里 `api.post('/xxx', authRequired?, handler)`。**几乎所有业务接口都是 `POST`**（含纯查询），靠动词后缀路径区分（如 `/api/posts/list`、`/api/posts/detail`）。

### 统一响应协议（`response.js`）
所有接口返回 `{ code, message, data }`。`code === 200` 为成功；否则失败，前端据 `message` toast。业务码分段：`10xx` 认证/用户、`20xx` 帖子/评论、`30xx` 私信/通知、`40xx` 举报，另有通用 `400/401/404/429/500`。`fail(code, msg)` 会按 `HTTP_STATUS` 映射设置真实 HTTP 状态码（便于前端按 401 拦截）。用 `success(data)` / `fail(CODE.X, msg)` 构造响应，不要手写 JSON。

### 横切关注点
- **鉴权中间件** `middleware.js` 的 `authRequired`：验签失败 → 401；成功把 `userId` 注入 context，handler 用 `c.get('userId')` 取。需要「可选鉴权」（游客也可访问但登录后多返回字段，如帖子详情）时，handler 内直接调 `verifyAuth(c.req.raw, c.env)`。
- **限流** `ratelimit.js`：固定窗口计数存 `rate_limits` 表。登录/注册按 IP（10 分钟 10 次），发帖/评论/私信/上传/举报按 userId（各自独立 key 与窗口）。
- **敏感词** `sensitive.js`：发帖/评论/私信内容做归一化包含匹配，命中即拦截（`CONTENT_BLOCKED`）。基础防线，配合举报+人工复核。
- **输入校验** `validate.js`：`LIMITS` 定义各字段长度上限，`requireText`/`optionalText` 校验；`escapeLike` 转义 LIKE 通配符防注入。
- **日志** `logger.js` + `logging` 中间件：记录入参/出参 code/message/耗时/报错。

### 认证（`auth.js`，全部基于 Web Crypto，不依赖 Node 库）
- 密码：PBKDF2-SHA256（10 万次迭代），存储格式 `salt:hash`（均为 hex），见 `hashPassword`/`verifyPassword`。
- Token：自实现 HS256 JWT（`signJWT`/`verifyJWT`），URL-safe base64（支持中文），30 天过期，**用 `Date.now()` 毫秒时间戳**作 `exp`/`iat`（非标准 JWT 的秒）。
- **Token 吊销**：JWT 载荷带 `tv`（token_version），`verifyAuth` 比对 DB 中 `users.token_version`，不等即失效。改密码/退出登录调 `bumpTokenVersion` 使版本 +1，令所有旧 token 立即失效。
- 主键 ID 用 `genId()`（去横杠 32 位 hex 的 UUID），不暴露递增规律。
- 用户表同时支持用户名密码和微信 openid 两种身份（`users.username` 与 `users.openid` 均可空且唯一）。

### 数据模型（`schema.sql` + `migrations/`）
主键全用 UUID(TEXT)，`created_at` 统一为毫秒时间戳(INTEGER)，与 JWT 口径一致。核心表：
- `users`：用户名密码 + 微信双身份，`token_version` 用于吊销 token。
- `posts`：`type` 区分四类业务（求助互助 `help`/闲置转让 `idle`/失物招领 `lost`/拼单拼团 `group`，菜单由后端 `MENUS` 常量统一下发）；`images` 存 R2 key 的 JSON 数组；`status` 为 `open`/`closed`；带 `contact`（隐私，仅登录详情返回）、`location`。
- `comments`：帖子评论。
- `messages`：点对点私信，`read` 标已读，`post_id` 记来源帖。
- `notifications`：`type` 取 `comment`/`respond`/`adopt`/`thank`，聚合未读角标。
- `post_responses`：帖子响应（我要帮忙/我想要/这是我的），`UNIQUE(post_id,user_id)` 保证幂等。
- `post_helpers`：关帖时采纳的帮助者（可多人，`thanked` 区分是否额外感谢），个人页「帮助了/获得帮助」统计据此计算。
- `reports`：举报沉淀（`status=pending`，**暂无管理后台**），`UNIQUE(reporter_id,target_type,target_id)` 防重复。
- `rate_limits`：限流计数。

小区结构（期数/楼栋/单元）由 `posts.js` 的 `COMMUNITY` 常量下发，注册/发帖位置选择用。

### 前端
- `src/api.js` 是唯一 HTTP 层：`request()` 自动附加 `Authorization: Bearer <token>`（token 存 localStorage），解析 `{code,message,data}`，非 200 默认 toast `message` 并抛 `Error`（`err.code` 带业务码）；401 清 token 并跳登录。`api` 对象集中所有接口方法，新增后端接口时在此加方法。图片上传 `uploadImage` 走 multipart，单独处理。
- `src/hooks/useAuth.jsx`：`AuthProvider`/`useAuth`，挂载时用本地 token 调 `getMe()`（silentAuth）恢复登录态，失败则清 token。
- 路由在 `App.jsx`（react-router）：公开 `/`、`/discover`、`/post/:id`、`/login`；受保护（`RequireAuth`）`/create`、`/edit/:id`、`/profile`、`/messages`、`/messages/:peerId`。页面在 `src/pages/`，路由级 `lazy` 懒加载。外层包 `ThemeProvider`(MUI) + `QueryClientProvider`(React Query) + `ErrorBoundary` + `ToastProvider`。
- React Query 重试策略：后端给了明确 `code`（非 500）一律不重试，仅网络中断/500 重试最多 2 次。
- 样式：**MUI 组件 + Tailwind v3 工具类并用**（Tailwind 经 `postcss.config.js` 接入，配置见 `tailwind.config.js`）。动效组件（如 `Orb`）用 `ogl`（WebGL）。

### 部署拓扑
前端 Pages 通过 `frontend/functions/{api,auth}/[[path]].js` 反向代理把 `/api`、`/auth` 转发到独立部署的 Worker（`*.workers.dev`）。目的：国内直连 workers.dev 常被墙，但可访问 Pages 主域，Pages→Worker 走 Cloudflare 内网。所以前端始终同源访问，跨域与可达性问题一并消除。
