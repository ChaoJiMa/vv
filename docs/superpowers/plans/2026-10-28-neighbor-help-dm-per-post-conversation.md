# 私信按帖拆会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一对用户、不同帖子的私信拆成独立会话；删帖后会话保留可继续聊。

**Architecture:** 新建 `conversations`（`user_a`/`user_b` 字典序 + `post_id` 唯一）；`messages.conversation_id` 必填；`ensure` 开空会话，`send`/`thread`/`conversations` 全部按会话 id；删帖不再清空 `post_id`。

**Tech Stack:** Cloudflare Worker (Hono) + D1、React 19 + React Router + React Query

**Spec:** `docs/superpowers/specs/2026-10-28-neighbor-help-dm-per-post-conversation-design.md`

## Global Constraints

- 新私信必须绑帖；无独立无帖入口
- 删帖：会话/消息保留，UI「原帖已删除」，仍可发信；不可对已删帖 ensure 新会话
- 本地可 `DELETE FROM messages` 后迁库；不做历史拆分迁移
- 本轮不主动 git commit（除非用户明确要求）
- 验证：`cd neighbor-help/worker && npm test`；`cd neighbor-help/frontend && npm run lint`

## File map

| 文件 | 职责 |
|------|------|
| `worker/migrations/0012_conversations.sql` | conversations 表 + messages 重建含 conversation_id |
| `worker/schema.sql` | 同步快照 |
| `worker/src/routes/messages.js` | ensure / send / thread / conversations |
| `worker/src/routes/posts.js` | 删帖去掉 messages post_id=NULL |
| `frontend/src/api.js` | ensureConversation、改 send/thread 签名 |
| `frontend/src/App.jsx` | `/messages/:conversationId` |
| `frontend/src/pages/Messages.jsx` | 列表字段与跳转 |
| `frontend/src/pages/Chat.jsx` | 按 conversationId |
| `frontend/src/pages/PostDetail.jsx` | ensure 后跳转 |

---

### Task 1: Migration + schema

**Files:**
- Create: `neighbor-help/worker/migrations/0012_conversations.sql`
- Modify: `neighbor-help/worker/schema.sql`

- [x] **Step 1: 写迁移**

```sql
-- 0012_conversations.sql —— 按帖会话；本轮允许清空旧私信
DELETE FROM messages;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  post_id TEXT NOT NULL,
  post_title TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER,
  created_at INTEGER,
  UNIQUE (user_a, user_b, post_id),
  FOREIGN KEY (user_a) REFERENCES users(id),
  FOREIGN KEY (user_b) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_a_last ON conversations(user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b_last ON conversations(user_b, last_message_at DESC);

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  post_id TEXT,
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id)
);
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, read);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
```

- [x] **Step 2: 同步 `schema.sql`**（conversations + messages 含 conversation_id；去掉仅 pair 索引说明改 conversation）

- [x] **Step 3: 本地 apply**

```bash
cd neighbor-help/worker
npx wrangler d1 migrations apply neighbor-help-db --local
```

Expected: 0012 applied

---

### Task 2: Worker messages API

**Files:**
- Modify: `neighbor-help/worker/src/routes/messages.js`
- Modify: `neighbor-help/worker/src/routes/posts.js`（删帖）

**Produces:**
- `pairUsers(a,b) => [user_a, user_b]` 字典序
- `POST /messages/ensure` `{ receiverId, postId }` → `{ conversationId, postId, postTitle, postDeleted:false }`
- `POST /messages/send` `{ conversationId, content }`
- `POST /messages/thread` `{ conversationId, page }`
- `POST /messages/conversations` 按会话列表

- [ ] **Step 1: 辅助函数 + ensure**

```js
function pairUsers(a, b) {
  return a < b ? [a, b] : [b, a]
}

// ensure: 校验 peer、查 posts 取 title；SELECT 会话；无则 INSERT
// 已删帖 → fail(CODE.POST_NOT_FOUND, '帖子不存在')
```

- [ ] **Step 2: send** — 按 conversationId 校验 `user_a|user_b`，插 messages（带 conversation_id、双方 id、conv.post_id），`UPDATE conversations SET last_message_at=?`

- [ ] **Step 3: thread** — 已读：`UPDATE messages SET read=1 WHERE conversation_id=? AND receiver_id=? AND read=0`；列表按 conversation_id；返回 peer + meta（LEFT JOIN posts 得 postDeleted）

- [ ] **Step 4: conversations list** — 从 conversations WHERE user_a=? OR user_b=? ORDER BY last_message_at DESC；peer 为另一方；末条与未读按 conversation_id 子查询

- [ ] **Step 5: posts/delete** — 删除 `UPDATE messages SET post_id=NULL...` 那一行；不删 conversations

- [ ] **Step 6: `npm test`** Expected: pass

---

### Task 3: Frontend api + routes + pages

**Files:**
- Modify: `neighbor-help/frontend/src/api.js`
- Modify: `neighbor-help/frontend/src/App.jsx`
- Modify: `neighbor-help/frontend/src/pages/Messages.jsx`
- Modify: `neighbor-help/frontend/src/pages/Chat.jsx`
- Modify: `neighbor-help/frontend/src/pages/PostDetail.jsx`

- [ ] **Step 1: api.js**

```js
ensureConversation: (receiverId, postId) => post('/api/messages/ensure', { receiverId, postId }),
sendMessage: (conversationId, content, options) => post('/api/messages/send', { conversationId, content }, options),
getThread: (conversationId, page = 1) => post('/api/messages/thread', { conversationId, page }),
```

- [ ] **Step 2: App** — `<Route path="/messages/:conversationId" element={<Chat />} />`

- [ ] **Step 3: PostDetail** — 响应成功 / 点私信：

```js
const { conversationId } = await api.ensureConversation(authorId, id)
navigate(`/messages/${conversationId}`)
```

- [ ] **Step 4: Messages 列表** — key/跳转用 `conversationId`；次行 ``${it.postDeleted ? '原帖已删除' : it.postTitle} · ${preview}``

- [ ] **Step 5: Chat** — `useParams().conversationId`；queryKey `['thread', conversationId]`；顶栏帖标题可点（未删 → `/note/:postId`）；send 只传 conversationId

- [ ] **Step 6: `npm run lint`** Expected: exit 0

---

### Task 4: 手动验收要点

- [ ] 两账号、两帖：分别私信 → 列表两行、内容不串
- [ ] 删帖 → 会话仍在、「原帖已删除」、可继续发；ensure 同 postId 失败

---

## Spec coverage (self-review)

| Spec | Task |
|------|------|
| conversations 表 + UNIQUE | T1 |
| messages.conversation_id | T1–T2 |
| ensure / send / thread / list | T2–T3 |
| 删帖保留会话 | T2 |
| 路由 / UI / 原帖已删除 | T3–T4 |
| 清空本地不迁历史 | T1 DELETE |
