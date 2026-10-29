# 邻里里私信「按帖拆会话」Design

日期：2026-10-28  
状态：已落地（方案 3：`conversations` 表）  
前置：现有点对点私信（`messages` + `/messages/:peerId`）、帖子详情响应/私信入口

## 目标

同一对用户、不同帖子的私信拆成独立会话（例如对 admin 的「我想要」与「我要帮忙」不再挤在同一对话框）。

## 非目标

- 无帖私信入口、群聊、会话置顶/免打扰
- 改通知流（评论 / 点赞 / 响应仍走 `notifications`）
- Messages 页整体改版（仅列表字段与跳转适配按帖会话）
- 生产库历史会话迁移（本轮允许清空本地/测试私信）

## 决策摘要

| 项 | 选择 |
|----|------|
| 会话粒度 | 对方用户 + 帖子 |
| 实现 | 新建 `conversations` 表；消息挂 `conversation_id` |
| 无帖私信 | 不支持新建；现有产品亦无单独私信入口 |
| 删帖后 | 会话与消息保留，可继续聊；UI 显示「原帖已删除」 |
| 历史数据 | 清空本地 messages，不做拆分迁移 |

## 数据模型

### `conversations`（新建）

| 字段 | 说明 |
|------|------|
| `id` | 主键 UUID |
| `user_a` / `user_b` | 双方用户 id；写入时按字典序排序，保证同一对+帖唯一 |
| `post_id` | 来源帖；**删帖后仍保留**（不置 NULL） |
| `post_title` | 创建会话时标题快照；删帖后列表/顶栏依赖此字段 |
| `last_message_at` | 最新消息时间，列表排序 |
| `created_at` | 创建时间 |

约束：`UNIQUE(user_a, user_b, post_id)`。  
索引：`(user_a, last_message_at)`、`(user_b, last_message_at)`（或等价便于「我参与的会话」查询）。

### `messages`（改动）

- 新增 `conversation_id TEXT NOT NULL`（新数据必填；迁移前清空旧行后再加列）
- 发送路径：会话已存在时直接插消息并更新 `last_message_at`
- 本轮保留列 `post_id`（与会话一致写入，便于排查），**查询与已读一律按 `conversation_id`**

### 删帖行为（改动）

现有：`UPDATE messages SET post_id=NULL WHERE post_id=?`。  
改为：**不再清空**消息/`conversations` 上的 `post_id`；帖子及相关评论/点赞/通知等照旧删除。会话行保留。

### 历史数据（迁移 0012）

- 有 `post_id` 的旧私信：按双方+帖建 `conversations` 并挂上 `conversation_id`
- 无 `post_id` 的旧私信：无法归属会话，迁移时丢弃
- 空会话（仅 ensure、未发信）：列表不展示；超过 24h 在 ensure 时清理

## 接口

### `POST /api/messages/ensure`（新建）

参数：`{ receiverId, postId }` → 返回 `{ conversationId, postId, postTitle, postDeleted }`

- 帖须存在；**当前用户与 `receiverId` 之一必须为帖主**，否则拒绝
- 按双方+帖 find-or-create；首次写入 `post_title`，已存在则用帖面标题刷新快照
- 供详情「响应 / 私信」跳转前拿到 `conversationId`（允许尚未有任何消息的空会话）

### `POST /api/messages/send`

参数：`{ conversationId, content }`（聊天页内发送）

- 校验当前用户为会话一方 → 插消息 → 更新 `last_message_at`
- 已删帖的已有会话仍可发信
- 敏感词 / 限流保持现状
- 兼容：若仍传 `receiverId+postId` 而无 `conversationId`，服务端可先 ensure 再发（可选，前端以 ensure + conversationId 为主路径）

### `POST /api/messages/thread`

参数：`{ conversationId, page }`

- 已读：仅标记该会话内、对方发给我的未读
- 返回：`peer`、会话元信息（`conversationId`、`postId`、`postTitle`、`postDeleted`）、`list`、`page`、`hasMore`

### `POST /api/messages/conversations`

- 按 `conversations.last_message_at` 倒序分页
- 每项：`conversationId`、对方信息、`postId` / `postTitle` / `postDeleted`、末条内容、`fromMe`、`unread`、`createdAt`（末条时间）

### 未读

`POST /api/messages/unread` 仍按 `messages.read` 计数，逻辑不变。

## 前端路由与入口

- 聊天页：`/messages/:conversationId`（取代裸 `/messages/:peerId`）
- 消息列表点行 → `/messages/${conversationId}`
- 帖子详情「响应 / 私信」：先 `messages/ensure`，再 `navigate(/messages/${conversationId})`，不再用 `location.state.postId` 作会话键

## UI

### 私信列表

- 一行 = 一个会话（同一人多帖多行）
- 主行：对方昵称
- 次行：`帖标题 · 末条预览`；`postDeleted` 时帖标题文案为「原帖已删除」

### 聊天页

- 顶栏：对方昵称；弱文案为帖标题（已删则「原帖已删除」）
- 帖仍在时可点标题进 `/note/:postId`；已删则 toast「原帖已删除」、不跳转
- 删帖后输入框仍可用，可继续发信

## `postDeleted` 判定

`LEFT JOIN posts`：无对应行则 `postDeleted: true`；展示标题优先用 `conversations.post_title`，空则「原帖已删除」。

## 错误语义（要点）

| 场景 | 行为 |
|------|------|
| ensure 缺 postId / receiverId | 须从帖子发起私信 |
| ensure 用已删 postId | 帖子不存在 |
| ensure 双方皆非帖主 | 只能与帖主发起该帖私信 |
| conversationId 非当前用户参与 | 会话对象无效 |
| 已有会话 + 帖已删 + 发信 | 允许 |

## 验收

1. 用户 A 对同一作者两篇不同帖分别响应/私信 → 消息列表出现两条会话；内容互不串台  
2. 删帖后原会话仍在列表，标题为「原帖已删除」，双方仍可发信；不可再对该 postId 开新会话  
3. 无帖参数无法新建私信；通知 Tab 行为不变  
4. 本地清空旧私信后迁移可干净应用  

## 实现范围（后续 plan）

- Worker：migration + `schema.sql` + `messages.js` + 删帖路径  
- Frontend：`api.js`、`App.jsx` 路由、`Messages.jsx`、`Chat.jsx`、`PostDetail.jsx` 跳转  
- 本地 D1 清空 messages 后 apply migration  
