# 帖子详情小红书式布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `PostDetail` 改成小红书式：按比例大图、封面下作者行、赞与主操作沉底栏，作者管理进 ⋯。

**Architecture:** 仅改前端 `PostDetail.jsx`；封面比例用 `coverAspectRatio` + 预加载，详情专用夹限 0.75～1.6 且 ≤70vh；底栏融合评论输入 / 赞 / 访客主操作或作者 ⋯；Sheet 与 API 不变。

**Tech Stack:** React 19、现有 `api` / `typeTheme` / `image` utils、MUI 无关（保持 inline style）。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-28-neighbor-help-post-detail-xhs-layout-design.md`
- 不改 Worker / API；读写优先 `author` / `stats` / `viewer` / `cover`，fallback 旧字段
- 不做收藏、分享、关注、楼中楼
- 前端无自动化测试套件：用手测 + `npm run lint` + `npm run build`
- 未要求则不 git commit

---

## File map

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/imageAspect.js` | 新增详情用 `clampDetailAspect` / 常量（与列表夹限分离） |
| `frontend/src/pages/PostDetail.jsx` | 封面高度、作者行、去正文操作条、融合底栏 + 作者菜单 |

---

### Task 1: 详情封面比例工具

**Files:**
- Modify: `neighbor-help/frontend/src/utils/imageAspect.js`
- Modify: `neighbor-help/frontend/src/pages/PostDetail.jsx`（仅接入高度计算，可与 Task 2 同批）

**Interfaces:**
- Produces: `DETAIL_ASPECT_MIN = 0.75`, `DETAIL_ASPECT_MAX = 1.6`, `clampDetailAspect(hOverW)`, `detailCoverHeightPx({ aspect, widthPx, maxVh = 0.7 })`

- [ ] **Step 1: 在 `imageAspect.js` 追加**

```js
export const DETAIL_ASPECT_MIN = 0.75
export const DETAIL_ASPECT_MAX = 1.6

export function clampDetailAspect(hOverW) {
  if (!Number.isFinite(hOverW) || hOverW <= 0) return 1
  return Math.min(DETAIL_ASPECT_MAX, Math.max(DETAIL_ASPECT_MIN, hOverW))
}

/** 封面像素高度：width × aspect，再不超过 viewport * maxVh */
export function detailCoverHeightPx({ aspect, widthPx, maxVh = 0.7 }) {
  const a = clampDetailAspect(aspect)
  const w = Math.max(1, widthPx || (typeof window !== 'undefined' ? window.innerWidth : 390))
  const raw = Math.round(w * a)
  const maxH = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * maxVh)
  return Math.min(raw, maxH)
}
```

- [ ] **Step 2: `npm run lint`（frontend）应通过**

---

### Task 2: 封面按比例 + 作者行 + 正文去操作条

**Files:**
- Modify: `neighbor-help/frontend/src/pages/PostDetail.jsx`

**Interfaces:**
- Consumes: `coverAspectRatio`, `coverKey`, `clampDetailAspect`, `detailCoverHeightPx`, `loadImageAspect`（详情版：加载后用 `clampDetailAspect`，勿用列表的 `clampAspect`）
- Produces: 封面动态 height；作者行 UI；正文无内嵌赞/主操作条

- [ ] **Step 1: 增加封面高度 state**

有图：`known = coverAspectRatio(post)` → 有则 `detailCoverHeightPx`；无则先用 `aspect=1` 高度，`useEffect` 里 `loadImage` 取 natural 比例后 `clampDetailAspect` 再算高度。  
无图：`detailCoverHeightPx({ aspect: NO_IMAGE_ASPECT, widthPx })`。  
横滑容器与每张图 `height: coverH`（替换固定 240/200）。

注意：`loadImageAspect` 当前内部用列表夹限；详情应自写预加载或临时扩展 `loadImageAspect(url, { clamp: clampDetailAspect })`。推荐在 PostDetail 内：

```js
function loadDetailAspect(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(clampDetailAspect((img.naturalHeight || 1) / (img.naturalWidth || 1)))
    img.onerror = () => resolve(1)
    img.src = url
  })
}
```

- [ ] **Step 2: 封面下插入作者行**

头像（`author.avatar` / 首字）+ 昵称 + `[building, unit]`；样式 padding `14px 16px 0`。

- [ ] **Step 3: 正文区**

保留标题、正文、联系信息块、helpers chip、responses 段。  
**删除**内嵌赞按钮整块，以及底部「编辑/标记完成/删除/响应/私信」那一排 `flex` 操作区。

- [ ] **Step 4: lint**

---

### Task 3: 融合底栏 + 作者 ⋯ 菜单

**Files:**
- Modify: `neighbor-help/frontend/src/pages/PostDetail.jsx`

**Interfaces:**
- Consumes: 现有 `likePost`/`unlikePost`、`respondPost`、`commentMutation`、`setAdoptOpen`、`setDeleteOpen`、`navigate(/edit/...)`
- Produces: `composerBar` 内：input | 赞 | 主按钮或 ⋯；`authorMenuOpen` Sheet/popover

- [ ] **Step 1: 改 `composerBar` 内容**

```
[ input flex:1  placeholder「说点什么…」] [ 赞按钮 ] [ 主区 ]
```

- 赞：逻辑同现详情点赞（更新 queryCache 的 viewer/stats 双写字段）
- 发送：保留——输入非空时点发送或可改为回车发送；保留发送 Button 会挤占空间时：主区优先，发送可改为 input 内嵌或仅在有文字时显示小「发送」。**本计划约定**：有文字时在赞左侧显示小「发送」按钮，无文字时隐藏，省出右侧主操作位。

- [ ] **Step 2: 右侧主区状态机**

```
if (!user) → Button「登录」→ /login
else if (user.id === authorId) → IconBtn「⋯」→ 打开 Sheet「管理」：
  - open: 编辑 → /edit/:id
  - open: 标记完成 → setAdoptOpen(true)
  - 删除 → setDeleteOpen(true)
else if (RESPOND_LABEL[type])
  if (responded) → Button「私信」→ /messages/:authorId
  else if (closed) → disabled 或隐藏
  else → Button RESPOND_LABEL → respondMutation
else → Button「私信 TA」
```

- [ ] **Step 3: 作者管理用 `Sheet`（heightVh≈36）列出三项按钮**，不要用 window.confirm。

- [ ] **Step 4: `AppShell` `paddingBottom` 保持足够避开底栏（现有 ~88 可略增若底栏变高）。

- [ ] **Step 5: 手测清单（本地）**

  - 竖图/横图/无图封面高度
  - 赞、评论发送
  - 访客响应/私信；作者 ⋯ 三项
  - 联系可见性、采纳 Sheet

- [ ] **Step 6: `npm run lint` && `npm run build`（frontend cwd）**

---

## Spec coverage check

| Spec 项 | Task |
|---------|------|
| 封面比例 0.75–1.6 + 70vh | T1–T2 |
| 作者行 | T2 |
| 正文去赞/操作条 | T2 |
| 底栏评论+赞+主操作/⋯ | T3 |
| Sheet 保留 | T3（不改 Adopt/Report/Delete） |
| lint/build | T3 |

## Placeholder scan

无 TBD；详情预加载自写 `loadDetailAspect`，避免与列表 `clampAspect` 冲突。
