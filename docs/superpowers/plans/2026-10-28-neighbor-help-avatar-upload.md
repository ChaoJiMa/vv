# 头像上传 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用户可在编辑资料中选图预览并保存头像；主页点头像仅开弹窗；展示兼容 R2 key 与外链。

**Architecture:** 复用 `POST /api/upload`；扩展 `POST /api/me/update` 的可选 `avatar`；前端 `resolveAvatarUrl` 统一展示；EditProfileForm 草稿预览后随保存提交。

**Tech Stack:** Hono/D1 Worker、现有 images 校验、React Profile 编辑弹窗、`api.uploadImage`。

**Spec:** `docs/superpowers/specs/2026-10-28-neighbor-help-avatar-upload-design.md`

---

## 文件

| 文件 | 职责 |
|------|------|
| `worker/src/validate.js` | `parseAvatarUpdate`：省略 / 清空 / key |
| `worker/test/validate-avatar.test.js` | 单测 |
| `worker/src/routes/posts.js` | `/me/update` 写 avatar |
| `frontend/src/utils/avatar.js` | `resolveAvatarUrl` |
| `frontend/src/pages/Profile.jsx` | 编辑表单选图 + 头区展示 |
| `frontend/src/components/ui/PostCard.jsx` 等 | 作者头走 resolve |

---

### Task 1: 后端 parseAvatarUpdate + me/update

**Steps:**
1. 红：`validate-avatar.test.js` 覆盖省略、`""`/`null`、合法 key、非法 key
2. 绿：实现 `parseAvatarUpdate`；`/me/update` 在 `change` 时写入 `users.avatar`
3. `cd neighbor-help/worker && npm test`

### Task 2: 前端 resolveAvatarUrl + 编辑上传

**Steps:**
1. 新增 `utils/avatar.js`（空→null；http(s)→原样；否则 `api.imgUrl`）
2. Profile 头区 / EditProfileForm 使用；表单选图 upload → 草稿；保存带 `avatar`
3. PostCard、PostDetail、Messages 等 img 源改 resolve
4. `cd neighbor-help/frontend && npm run lint`
