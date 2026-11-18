# neighbor-help

邻里互助小程序

## 项目结构

```
neighbor-help/
├── frontend/   # React 前端 (Cloudflare Pages)
└── worker/     # Cloudflare Workers 后端 + D1 数据库
```

## 快速开始

本地开发和测试使用 Node.js 22.13 或更高版本。后端回归测试使用 Node 内置 SQLite，在内存数据库中验证 SQL，不连接生产数据库。

### 1. 准备环境变量

**后端** — 在 Cloudflare Dashboard 设置 Workers 环境变量：
- `WX_APPID` — 微信开放平台 AppID
- `WX_SECRET` — 微信开放平台 AppSecret
- `JWT_SECRET` — 自定义随机字符串（用于签发 token）

**前端** — 复制 `.env.example` 为 `.env.local`：
```
VITE_WX_APPID=你的微信AppID
VITE_API_URL=https://你的worker名.workers.dev
```

### 2. 部署后端

```bash
cd worker
npx wrangler login
# 仅全新环境需要创建数据库
npx wrangler d1 create neighbor-help-db
# 把返回的 database_id 填入 wrangler.toml
npx wrangler d1 migrations apply neighbor-help-db --remote
npx wrangler deploy
```

已有环境升级时，必须先应用 `0014_image_deletions.sql`，再部署 Worker 和前端。新的读图、发帖和图片绑定依赖 `image_deletions` 表；未迁移会返回 500。

- 已通过迁移升级到 `0013` 的数据库：先运行 `npx wrangler d1 migrations list neighbor-help-db --remote`，确认待应用列表仅包含预期新增迁移，再运行 `npx wrangler d1 migrations apply neighbor-help-db --remote`。
- 由旧版 `schema.sql` 手动建库、没有迁移记录的数据库：确认现有结构已包含 `0013` 的功能后，仅执行 `npx wrangler d1 execute neighbor-help-db --remote --file=migrations/0014_image_deletions.sql`。不要直接补跑整个迁移链：历史 `0002` 会删除并重建用户、帖子和评论表。
- 本地开发使用 `--local` 应用迁移；`schema.sql` 用于结构参考，后续升级使用增量迁移。详见 `worker/migrations/README.md`。

启用本轮可选邀请码时，还需在发布新 Worker 前应用 `0015_registration_invite.sql`。已有环境先核对迁移记录和 `users` 实际列，不能重跑历史建库链；该增量 `ALTER TABLE` 不应手动重复执行。旧前端不传邀请码仍兼容新服务；新前端通过公开注册能力查询识别旧服务，未支持时非空邀请码会就地提示。详见 [注册接口说明](../docs/interfaces/neighbor-help/registration.md) 和 [增量迁移注意事项](worker/migrations/README.md)。

### 3. 部署前端

```bash
cd frontend
cp .env.example .env.local
# 编辑 .env.local 填入配置
npm install
npm run build
npx wrangler pages deploy dist
```

### 4. 本地开发

```bash
# 终端1：启动后端
cd worker && npx wrangler dev

# 终端2：启动前端
cd frontend && npm run dev
```

## 本地验证

前端目录运行 `npm ci`、`npm test`、`npm run lint` 和 `npm run build`；后端目录运行 `npm ci` 和 `npm test`。

图片上传会记录当前用户，新绑定的图片必须由本人上传且未超过 24 小时（预留一分钟提交余量）；已有历史图片可在原帖子/头像位置保留。改头像、编辑和删帖移除引用后，会检查全部帖子和头像引用，为无引用图片写入删除声明并尝试删除对象；定时任务兜底重试并清理超过宽限期的孤儿图片。损坏的图片引用会中止当轮清理并记录错误。读图保留每次重验证和删除声明检查，ETag 命中时通过 R2 条件读取返回 304，不读取图片正文。

## 功能

- 求助互助：发布邻里求助需求
- 闲置转让：转让或免费赠送闲置物品
- 失物招领：发布丢失或捡到的物品
- 拼单拼团：组织邻居一起拼外卖/团购

## 浏览与草稿

发现页支持通过 `/discover?type=idle&keyword=台灯` 保留和分享分类搜索条件，并在从详情返回时恢复浏览位置。发帖和编辑自动保存当前标签页的 24 小时文字草稿，离开时可选择保留或放弃；图片改动需重新选择。分页或聊天请求失败可就地重试并保留已有内容。完整使用方式及限制见 [前端说明](frontend/README.md)。
