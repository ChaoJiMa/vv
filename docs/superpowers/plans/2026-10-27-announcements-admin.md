# 公告表管理 + role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在远端 `app_config` 主干上新增 `announcements` 表与管理员 CRUD，公开 list 仍返回 `{ notices, safetyTips }`。

**Architecture:** 迁移加 `users.role` + 公告表并导入配置中的 notices；`routes/announcements.js` 提供公开 list（表拼 notices + config 读 tips）与 admin CRUD；前端 Profile 入口 + 管理页；Home 契约不变。

**Tech Stack:** Hono Worker、D1、React 19、MUI、React Query

## Global Constraints

- 公开契约：`POST /api/announcements/list` → `{ notices: string[], safetyTips: [{ icon, text }] }`
- `safetyTips` 只读 `app_config` / FALLBACK；管理页不管 tips
- 表无启用行时 `notices` 用 `ANNOUNCEMENTS_FALLBACK.notices`
- 管理鉴权：每次查库 `role === 'admin'`；401/403
- `content` ≤ 200；时间戳 INTEGER 毫秒
- **不做** contact 加密、safetyTips 管理、stash 整包恢复
- 验证：`cd neighbor-help/worker && npm test`；`cd neighbor-help/frontend && npm run lint`
- 不自动 git commit（除非用户明确要求）

---

## File map

| 文件 | 职责 |
|---|---|
| Create: `worker/migrations/0010_announcements_admin.sql` | role + 表 + 从 app_config 导入 notices |
| Modify: `worker/schema.sql` | 同步快照 |
| Modify: `worker/src/response.js` | `CODE.FORBIDDEN = 403` |
| Modify: `worker/src/validate.js` + `test/validate.test.js` | `LIMITS.announcement = 200` |
| Modify: `worker/src/config.js` | 导出 FALLBACK；可选 `getSafetyTips` |
| Create: `worker/src/routes/announcements.js` | 公开 list + admin CRUD |
| Modify: `worker/src/routes/posts.js` | 删除旧 list 路由；`me/get` 含 role |
| Modify: `worker/src/routes/auth.js` | 注册 SELECT 含 role |
| Modify: `worker/src/index.js` | 挂载 announcements（在 messages/reports 前） |
| Modify: `worker/src/logger.js` | 公告路由中文描述 |
| Modify: `frontend/src/api.js` | admin 四个方法 |
| Create: `frontend/src/pages/AnnouncementsManage.jsx` | 管理页 |
| Modify: `frontend/src/App.jsx` / `Profile.jsx` | 路由与入口 |

---

### Task 1: 迁移 0010 + schema

**Files:**
- Create: `neighbor-help/worker/migrations/0010_announcements_admin.sql`
- Modify: `neighbor-help/worker/schema.sql`

**Interfaces:**
- Produces: `users.role`；表 `announcements`；导入逻辑见 SQL

- [ ] **Step 1: 写迁移**

```sql
-- 0010_announcements_admin.sql —— 用户角色 + 滚动公告表(从 app_config.notices 导入)
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_announcements_enabled_sort
  ON announcements(enabled, sort DESC, updated_at DESC);

UPDATE users SET role = 'admin' WHERE username = 'admin';

-- 从 app_config 导入 notices(仅当公告表为空且配置存在时)
-- D1/SQLite: json_each 展开数组; id 用固定前缀+key 保证可重跑去重
INSERT INTO announcements (id, content, sort, enabled, created_at, updated_at)
SELECT
  printf('seed-%03d', je.key),
  je.value,
  (1000 - CAST(je.key AS INTEGER)),
  1,
  1760000000000,
  1760000000000
FROM app_config ac, json_each(json_extract(ac.value, '$.notices')) AS je
WHERE ac.key = 'announcements'
  AND NOT EXISTS (SELECT 1 FROM announcements LIMIT 1);
```

若本地 `json_each` 行为异常：改为硬编码插入与 FALLBACK 三条一致的种子（仍带 `WHERE NOT EXISTS`）。

- [ ] **Step 2: 同步 schema.sql**（users.role + announcements 表；不含 UPDATE/导入）

- [ ] **Step 3: 本地 apply**

`cd neighbor-help/worker; npx wrangler d1 migrations apply neighbor-help-db`

Expected: `0010` applied；`SELECT role FROM users WHERE username='admin'` → `admin`；announcements 有行或空（视导入）。

---

### Task 2: LIMITS.announcement + 单测

**Files:**
- Modify: `neighbor-help/worker/src/validate.js`
- Modify: `neighbor-help/worker/test/validate.test.js`

- [ ] **Step 1:** 测试 `LIMITS.announcement === 200` 与超长 `requireText` 失败  
- [ ] **Step 2:** `npm test -- test/validate.test.js` RED  
- [ ] **Step 3:** 加入 `announcement: 200`  
- [ ] **Step 4:** 再跑 GREEN  

---

### Task 3: FORBIDDEN + announcements 路由 + 挂载

**Files:**
- Modify: `neighbor-help/worker/src/response.js`（`FORBIDDEN: 403` + HTTP_STATUS）
- Modify: `neighbor-help/worker/src/config.js`（导出 `ANNOUNCEMENTS_FALLBACK` 或 `getSafetyTips(env)`）
- Create: `neighbor-help/worker/src/routes/announcements.js`
- Modify: `neighbor-help/worker/src/routes/posts.js`（删除原 `/announcements/list` 与多余 import）
- Modify: `neighbor-help/worker/src/index.js`
- Modify: `neighbor-help/worker/src/logger.js`（公开 + admin 五条描述）

**Interfaces:**
- `requireAdmin(c)` → 查库 role，失败返回 `fail(CODE.FORBIDDEN, ...)`
- 公开 list 组装：`{ notices, safetyTips }`
- Admin CRUD 同规格

- [ ] **Step 1:** 加 `CODE.FORBIDDEN`  
- [ ] **Step 2:** 实现 `announcements.js`（公开 list：查启用 content；空则 FALLBACK.notices；tips 用现有 loadConfig/FALLBACK）  
- [ ] **Step 3:** 从 `posts.js` 移除旧 list  
- [ ] **Step 4:** `app.route('/api', announcementRoutes)` 放在 `messageRoutes`/`reportRoutes` **之前**  
- [ ] **Step 5:** curl 公开 list 形状正确；未登录 admin/list → 401  

---

### Task 4: 用户对象返回 role

**Files:**
- Modify: `neighbor-help/worker/src/routes/posts.js` — `me/get` SELECT 加 `role`
- Modify: `neighbor-help/worker/src/routes/auth.js` — 注册后 SELECT 加 `role`（login `SELECT *` 已带）

- [ ] **Step 1–2:** 改 SELECT  
- [ ] **Step 3:** admin 登录后 `me/get` → `data.role === 'admin'`  

---

### Task 5: 前端 api + 管理页 + 入口

**Files:**
- Modify: `neighbor-help/frontend/src/api.js`
- Create: `neighbor-help/frontend/src/pages/AnnouncementsManage.jsx`
- Modify: `neighbor-help/frontend/src/App.jsx`
- Modify: `neighbor-help/frontend/src/pages/Profile.jsx`

**Interfaces:**
- 保持 `getAnnouncements`
- 新增 `adminListAnnouncements` / `adminCreateAnnouncement` / `adminUpdateAnnouncement` / `adminDeleteAnnouncement`
- 管理页：PageShell/BottomSheet/toast 风格对齐 Profile；`maxLength: 200`；非 admin 单次 toast + `/profile`

- [ ] **Step 1:** api 方法  
- [ ] **Step 2:** AnnouncementsManage 页  
- [ ] **Step 3:** 路由 `/announcements/manage`（RequireAuth 内）  
- [ ] **Step 4:** Profile 菜单 admin 入口  
- [ ] **Step 5:** `npm run lint`  

---

### Task 6: 端到端验收

- [ ] 双服务；`admin`/`admin123`（或现账号）登录  
- [ ] 管理页增 2 条不同 sort → 首页滚动顺序正确  
- [ ] 停用一条 → 公开 notices 变少；tips 仍在  
- [ ] 非 admin 无入口；直链管理页踢回；API 403  
- [ ] `npm test`；`npm run lint`  

---

## Spec coverage（计划自检）

| 规格项 | 任务 |
|---|---|
| role + 种子 admin | Task 1 |
| announcements 表 + 导入 notices | Task 1 |
| 公开 list 契约 + FALLBACK | Task 3 |
| safetyTips 仍配置 | Task 3 |
| admin CRUD + 查库鉴权 | Task 3 |
| me/登录 role | Task 4 |
| Home 少改 / 管理页 / Profile | Task 5 |
| 验收 1–5 | Task 6 |
| contact 加密 | 明确不在计划内 |
| FORBIDDEN 码 | Task 3（规格隐含 403） |

## 核对结论

- **覆盖完整**：规格目标/验收均有对应 Task；非目标未混入。  
- **风险点已写入计划**：`json_each` 导入失败时的硬编码种子后备；挂载顺序；不自动 commit。  
- **与旧 stash/旧 0007 无关**：迁移号从 `0010` 起，接远端 `0009`。  
- **待实现**：本文件仅为计划，代码尚未改（除既有未提交 `CLAUDE.md`）。
