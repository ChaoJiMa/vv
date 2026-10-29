# 邻里里评论楼中楼（两层）+ 作者置顶 Design

日期：2026-10-28  
状态：已落地  
范围：Worker + 前端详情评论区

## 目标

1. 支持对**顶评**的二级回复（楼中楼两层，不可再套第三层）  
2. 默认每楼展示 2 条回复，其余「展开更多」  
3. 发帖作者可将 **1 条**顶评置顶（再置顶则替换）

## 非目标

- 无限嵌套 / 三层以上  
- 回复里再回复成独立楼层（点回复仍挂到该楼顶评）  
- 本轮不做 `@` 结构化提及（输入框可用「回复 昵称」文案提示即可）  
- 不改首页瀑布流

## 决策摘要

| 项 | 选择 |
|----|------|
| 嵌套 | 两层：`comments` 顶评 + `comment_replies` 二级 |
| 展示 | 默认 2 条回复，其余展开分页 |
| 置顶 | 整帖仅 1 条顶评；`comments.pinned_at` |
| 通知 | 二级回复通知顶评作者；类型沿用 `comment` |

## 数据模型

### `comments`（既有，增量）

- 新增 `pinned_at INTEGER NULL`：非空表示置顶时间；同帖最多一条非空（应用层保证：pin 时先清空该帖其它行）

### 新表 `comment_replies`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | UUID |
| `comment_id` | TEXT NOT NULL | 所属顶评 |
| `post_id` | TEXT NOT NULL | 冗余，便于删帖/计数 |
| `user_id` | TEXT NOT NULL | 作者 |
| `content` | TEXT NOT NULL | 正文 |
| `created_at` | INTEGER | 毫秒 |

索引：`(comment_id, created_at)`、`(post_id)`。  
外键：`comment_id → comments(id)`、`post_id → posts(id)`、`user_id → users(id)`（与项目现风格一致）。  
删顶评 / 删帖：级联或显式 DELETE replies。

迁移：`worker/migrations/0012_comment_replies_pin.sql`；同步更新 `schema.sql`。

## 计数与排序

- `comment_count` / `stats.commentCount` = `COUNT(comments WHERE post_id)` + `COUNT(comment_replies WHERE post_id)`  
- `last_reply_at` = `MAX(顶评 created_at, 回复 created_at)`（子查询取两者最大）  
- 顶评列表排序：`pinned_at IS NOT NULL DESC, created_at ASC`（置顶永远在前，其余仍时间正序）

## API

### 调整

- `POST /api/posts/comments`（及 detail 内嵌首页 comments）  
  - 仍只分页**顶评**  
  - 每条增加：  
    - `pinned` / `pinnedAt`（双写可选：`pinned_at`）  
    - `replies: { list, total, page: 1, hasMore }`，`list` 最多 **2** 条（按 `created_at ASC`）

### 新增

| 路径 | 参数 | 说明 |
|------|------|------|
| `POST /api/posts/comment/replies` | `{ commentId, page }` | 某顶评下回复分页，pageSize=20 |
| `POST /api/posts/comment/reply` | `{ commentId, content }` | 发表二级回复；鉴权；敏感词；限流同评论 |
| `POST /api/posts/comment/reply/delete` | `{ id }` | 仅本人删回复 |
| `POST /api/posts/comment/pin` | `{ id }` | 仅**帖作者**；先 `UPDATE comments SET pinned_at=NULL WHERE post_id=?`，再设当前 `pinned_at=now` |
| `POST /api/posts/comment/unpin` | `{ id }` | 仅帖作者；清空该条 `pinned_at` |

校验：`comment/reply` 的 `commentId` 必须存在且属于该帖；不允许对 reply id 再套一层。

### 举报（本轮）

- `targetType: 'reply'` 写入 `reports`（若现表约束仅为 post|comment，扩展允许 `reply`，`target_id` 为 reply id）

### 前端 `api.js`

- `getCommentReplies`, `addCommentReply`, `deleteCommentReply`, `pinComment`, `unpinComment`

## 详情 UI（PostDetail）

1. 顶评行：昵称 / 楼栋 / 正文；`pinned` 时显示「置顶」标签  
2. 帖作者：顶评菜单或按钮「置顶」/「取消置顶」  
3. 所有人：顶评「回复」→ 底栏进入回复模式（placeholder「回复 @昵称」），发送走 `comment/reply`；可取消回复模式  
4. 二级列表缩进；默认渲染 `replies.list`（≤2）；`hasMore` 时「还有 N 条回复」→ 调 `comment/replies` 追加  
5. 二级：本人可删；他人可举报（`reply`）  
6. 底栏无回复目标时仍发顶评（现 `comment`）

## 实现面

- Worker：migration、`posts.js` 评论相关、`logger.js` 路由描述、删帖级联 replies、`comment_count`/`last_reply_at` 子查询更新  
- 前端：`PostDetail.jsx` 评论区重构、`api.js`  
- 验收：`npm test`（worker）、`npm run lint` + `build`（frontend）

## 验收清单

- [ ] 可对顶评回复；不可形成第三层  
- [ ] 默认 2 条，展开可加载更多  
- [ ] 作者置顶唯一；列表置顶在最上并有标签  
- [ ] 删顶评/删帖清理 replies；计数含回复  
- [ ] lint / test / build 通过
