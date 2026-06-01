# neighbor-help

邻里互助小程序

## 项目结构

```
neighbor-help/
├── frontend/   # React 前端 (Cloudflare Pages)
└── worker/     # Cloudflare Workers 后端 + D1 数据库
```

## 快速开始

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
npx wrangler d1 create neighbor-help-db
# 把返回的 database_id 填入 wrangler.toml
npx wrangler d1 execute neighbor-help-db --file=schema.sql
npx wrangler deploy
```

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

## 功能

- 求助互助：发布邻里求助需求
- 闲置转让：转让或免费赠送闲置物品
- 失物招领：发布丢失或捡到的物品
- 拼单拼团：组织邻居一起拼外卖/团购
