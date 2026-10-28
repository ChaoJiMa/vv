# 邻里里 API 字段标准化与兼容迁移 Design

日期：2026-10-28  
状态：草案（待确认后实施）

## 目标

1. 对外 JSON **统一 camelCase**（与前端 React 习惯一致）  
2. 资源造型更清晰：`author` 嵌套、`images` 为数组、计数命名统一  
3. 约定 **扩展位** 与向前兼容规则  
4. **过渡期双写**：新旧字段并存，降低前端一次性改爆风险  

## 非目标

- 本轮不改成 REST GET（保持全 POST + 动词路径）  
- 本轮不重命名 URL（`/posts/comment` 等路径整理可另开）  
- 不强制改 D1 列名（库内可继续 snake_case；仅在出口 DTO 映射）

## 兼容策略

### 阶段 A（推荐先做）：出口双写 + 前端读新优先

- Worker 响应同时带 **新字段（camelCase / 嵌套）** 与 **旧字段（现状）**  
- 前端改为优先读新字段，旧字段作 fallback  
- 文档标注旧字段 `deprecated`  

### 阶段 B：前端只读新字段

- 全站读路径切完后，去掉 fallback  

### 阶段 C：去掉旧字段

- 发版说明；确认无外部客户端依赖后再删双写  

本设计默认实施 **阶段 A**；B/C 另开任务。

## 通用信封（不变）

```json
{ "code": 200, "message": "ok", "data": { } }
```

- `code === 200` 成功  
- 客户端 **必须忽略 data 内未知键**（向前兼容）

## 扩展约定

| 位置 | 用途 |
|------|------|
| 资源根上的稳定字段 | 核心契约（id、title、author…） |
| `meta`（可选，挂在 list 的 data 上） | 分页外信息：`pageSize`、实验开关等 |
| `extensions`（可选，挂在单条资源上） | 非核心、可缺省：如 `contactUnavailable`、实验 UI 提示 |

过渡期：`contactUnavailable` 可先仍在根上双写，并同步放进 `extensions.contactUnavailable`。

## 分页 data（list 类）

| 新字段 | 旧字段 | 说明 |
|--------|--------|------|
| `list` | `list` | 不变 |
| `total` | `total` | 不变 |
| `page` | `page` | 不变 |
| `hasMore` | `hasMore` | 保持 camelCase |
| `meta.pageSize` | （无） | 新增，固定 20（与现实现一致） |

## 帖子 Post DTO

### 核心（新）

```json
{
  "id": "...",
  "type": "help|idle|lost|group",
  "title": "...",
  "content": "...",
  "images": ["key1.png"],
  "status": "open|closed",
  "location": "",
  "createdAt": 1793166522195,
  "author": {
    "id": "user-uuid",
    "nickname": "admin",
    "avatar": null,
    "building": "",
    "unit": ""
  },
  "stats": {
    "commentCount": 0,
    "likeCount": 0
  },
  "viewer": {
    "liked": false,
    "responded": false
  },
  "lastReplyAt": null,
  "extensions": {}
}
```

详情额外：

- `contact`（授权可见时）  
- `helpers` / `responses`（结构见下）  
- `extensions.contactUnavailable`（及根上双写）

### 双写映射表

| 新字段 | 旧字段（保留） | 备注 |
|--------|----------------|------|
| `createdAt` | `created_at` | |
| `author.id` | `user_id` | 根上仍出 `user_id` |
| `author.nickname` | `nickname` | 根上仍出扁平 nickname 等 |
| `author.avatar` | `avatar` | |
| `author.building` | `building` | |
| `author.unit` | `unit` | |
| `images`（array） | `images`（**过渡：同时给 array；旧客户端若当 string 用会坏**） | 见下方「images 特别说明」 |
| `stats.commentCount` | `comment_count` | |
| `stats.likeCount` | `like_count` | |
| `viewer.liked` | `my_liked`（list）/ `myLiked`（detail） | 统一语义后 list/detail 旧字段都双写两种写法？**否**：旧字段按接口现状各保留一种，新字段统一 `viewer.liked` |
| `viewer.responded` | `myResponded` | 仅详情 |
| `lastReplyAt` | `last_reply_at` | |

### images 特别说明

现状：DB/接口为 JSON **字符串**。  
阶段 A 建议：

- 新：`images: string[]`  
- 旧兼容：另加 `imagesRaw`（字符串）**或** 在双写文档中明确「破坏性：images 改为数组」，前端 `safeParse` 已兼容 string|array 则可只改出口为数组并保留 `safeParse`  

**推荐**：出口只返回 **数组**；前端 `safeParse` 继续兼容 string（已有）。视为对「误把 images 当 string 用的客户端」的小破坏，本仓库内可接受。

可选增强（阶段 A+）：

```json
"cover": { "key": "...", "width": 1080, "height": 1440 }
```

需上传时写入尺寸；无则 `cover` 可省略，前端继续预加载。

## 点赞响应

| 新 | 旧双写 |
|----|--------|
| `{ liked, likeCount }` | `{ liked, like_count }` |

## helpers / responses 条目

| 新 | 旧 |
|----|----|
| `helperId` | `helper_id` |
| `userId` | `user_id` |
| `thanked` | `thanked` |
| `nickname` / `building` | 同名 |

## 用户 Me DTO

保持字段集合；补 camelCase 双写：`createdAt` ← `created_at`。`openid` 是否对前端隐藏：建议 me 接口不返回 `openid`（若当前有返回则标 deprecated）。

## 实现面（阶段 A）

1. `worker/src/dto/`（或 `serialize.js`）：`serializePost(row, { viewer })`、`serializePostList`  
2. `posts/list`、`posts/detail`、`me/posts`、like/unlike 走序列化  
3. 前端：`PostCard` / `PostDetail` / 相关页读 `viewer.liked`、`stats.likeCount`、`author.*`，fallback 旧字段  
4. 单测：序列化快照 + list/detail 字段存在性  

## 验收

- 旧前端在只改后端双写时：列表点赞状态、详情响应状态不回归（fallback）  
- 新读路径：`viewer.liked` 在 list/detail 一致；无 `my_liked`/`myLiked` 混用依赖  
- `images` 为数组；瀑布流仍可用  
- lint / worker test / frontend build 通过  

## 待你确认

1. `images`：**只出数组**（推荐）还是额外保留字符串副本？  
2. `viewer` / `stats` / `author` 嵌套是否一次上齐，还是先只做 camelCase 扁平双写？  
3. 是否本轮就加 `cover.width/height`（要动上传）？
