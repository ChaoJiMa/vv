# 邻里互助 — 公告表管理 + 角色（接远端主干）设计规格

日期：2026-10-27  
分支：`feature/announcements-admin`  
范围：`neighbor-help/`（在已对齐 `origin/master` 的 `app_config` 体系上增量）

## 背景

远端主干已将首页公告/安全提示放入 `app_config`（键 `announcements` → `{ notices, safetyTips }`），公开接口 `POST /api/announcements/list` 返回该结构，配置缺失时用代码兜底。缺少：应用内管理、管理员角色。

本规格在**不推翻**配置体系的前提下：滚动公告改为 **D1 表 + 管理 CRUD**；安全提示仍走 `app_config`；公开响应形状保持不变。

此前本地实验过的「整包表方案 / stash」不整包合入；密码/JWT 维持现状；**联系方式落库加密另案**。

## 目标与边界

### 目标

1. `users.role`（`user` | `admin`），种子将 `username=admin` 升为 admin。  
2. 新建 `announcements` 表；公开 list 的 `notices` 来自启用中的表行；`safetyTips` 仍读 `app_config`。  
3. 管理员在「我的」进入管理页，可对滚动公告增删改、启停、排序。  
4. 公开契约不变：`{ notices: string[], safetyTips: [{ icon, text }] }`，Home 尽量少改。

### 非目标

- 安全提示（safetyTips）的 App 内管理  
- 联系方式 `contact` AES 落库加密（另开安全规格）  
- 忘记密码、举报复核后台、P0 theme/PageShell  
- 定时上下架、富文本、公告配图、多小区隔离  
- 从 `stash` 恢复旧 upload/主题实现  

## 方案选择

| 选项 | 结论 |
|---|---|
| 公告存储 | **独立 `announcements` 表**（非继续只改 JSON） |
| safetyTips | 仍在 `app_config`；本轮管理页不管 |
| 公开 API | **保持单一** `/api/announcements/list`，内部分表拼 notices + 配置读 tips |
| 管理员 | `users.role`，管理接口**每次查库** |
| 表空 notices | 使用现有 `ANNOUNCEMENTS_FALLBACK.notices`，避免首页空白 |
| contact 加密 | **另案**，不在本规格实现 |

## 数据模型

### `users.role`

- `TEXT NOT NULL DEFAULT 'user'`，取值 `user` | `admin`  
- 迁移：`0010_announcements_admin.sql`（接在 `0009` 之后）  
- 种子：`UPDATE users SET role = 'admin' WHERE username = 'admin'`  
- 同步 `schema.sql`

### `announcements`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | `genId()` |
| `content` | TEXT NOT NULL | trim 非空，最长 200 |
| `sort` | INTEGER NOT NULL DEFAULT 0 | 越大越靠前 |
| `enabled` | INTEGER NOT NULL DEFAULT 1 | `0` / `1` |
| `created_at` | INTEGER | `Date.now()` 毫秒 |
| `updated_at` | INTEGER | 同上 |

索引：`(enabled, sort DESC, updated_at DESC)` 或等价。

### 与 `app_config` 的关系

- 迁移时：若存在 `app_config.announcements` 且可解析出 `notices[]`，**一次性导入**为 `enabled=1` 行（按数组顺序赋予递减 `sort`）；`safetyTips` 留在配置不动。  
- 导入后：公开接口的 `notices` **只读表**（表无启用行则用代码 FALLBACK）；**不再读**配置里的 `notices` 字段（配置中旧 notices 可留作备份，避免双源）。  
- `getAnnouncements`（或等价）改为：组装 `{ notices, safetyTips }`；写路径只动表。

## API

全部 `POST` + JSON，`{ code, message, data }`。

### 公开

| 路径 | 鉴权 | 行为 |
|---|---|---|
| `/api/announcements/list` | 无 | `notices` = 启用表行的 `content[]`（sort DESC）；无启用行 → FALLBACK.notices。`safetyTips` = `app_config` / FALLBACK |

### 管理（登录 + `role === 'admin'`）

| 路径 | Body | 行为 |
|---|---|---|
| `/api/announcements/admin/list` | `{}` | 全部行（含停用） |
| `/api/announcements/admin/create` | `{ content, sort? }` | 默认 enabled=1、sort=0 |
| `/api/announcements/admin/update` | `{ id, content?, sort?, enabled? }` | 部分更新 |
| `/api/announcements/admin/delete` | `{ id }` | 物理删除 |

错误：未登录 401；非 admin 403；content 非法 400；id 不存在 404。

Worker：新建 `routes/announcements.js`（或从 `posts.js` 拆出公告相关），`index` 挂载在鉴权子应用之前；`me/get` 与登录/注册返回含 `role`。

## 前端

- **Home**：继续 `api.getAnnouncements()`（或同名封装），契约不变。  
- **Profile**：`user.role === 'admin'` 时「公告管理」→ `/announcements/manage`。  
- **AnnouncementsManage**：列表、新增/编辑、启停、删除确认；非 admin toast + 回「我的」。  
- **api.js**：`adminList/Create/Update/DeleteAnnouncement`；公开方法保持现有 `getAnnouncements`。

## 安全（本规格）

| 项 | 要求 |
|---|---|
| 密码 | 保持 PBKDF2；不改算法 |
| JWT | 保持 HS256 + `JWT_SECRET` + `token_version`；管理鉴权不依赖 JWT 内 role |
| 公告 content | 明文；长度限制；前端文本渲染 |
| contact 加密 | **不在此规格** → 见下文「后续：contact 加密」 |
| 日志 | 继续脱敏 password/token |

## 验收标准

1. `0010` apply 后，`admin` 用户 `role=admin`；普通用户无管理入口。  
2. 管理员 CRUD/启停生效；首页滚动仅启用公告，顺序符合 sort。  
3. 公开 list 仍含 `notices` + `safetyTips`；改表不破坏 tips。  
4. 非 admin 管理 API 403；管理路由被踢回。  
5. `npm test`（worker）、前端 `npm run lint` 通过。

## 风险与依赖

- 本地与生产均须先 `migrations apply` 再发 Worker。  
- 无 `username=admin` 时需手工升权。  
- Worker 内存配置缓存：`safetyTips` 路径保留；公告改走表后勿误清错缓存键。  
- 工作区另有未提交 `CLAUDE.md` 修正，可与本功能同 PR 或分开提交。

## 后续：contact 加密（另案，不在此实现）

- 目标：`posts.contact` AES-GCM 落库；密钥 `CONTACT_SECRET`（独立于 JWT）。  
- 存储格式如 `v1:<iv>:<cipher>`；读详情解密；旧明文兼容读、写回加密。  
- 单独规格 + 分支，避免与公告管理纠缠。

## 后续实现

规格确认后 → writing-plans → 按任务实现（建议 subagent-driven 或 inline）。
