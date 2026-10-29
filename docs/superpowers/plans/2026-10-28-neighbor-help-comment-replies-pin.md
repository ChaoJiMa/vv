# 评论楼中楼 + 置顶 Implementation Plan

> **For agentic workers:** Use executing-plans or implement task-by-task. Checkboxes track progress.

**Goal:** 两层评论（`comment_replies`）+ 作者唯一置顶顶评；详情默认露 2 条回复可展开。

**Architecture:** 迁移加表/列；`loadCommentsPage` 嵌套前 2 条 replies；新增 reply/pin API；PostDetail 评论区重构。

**Tech Stack:** D1 migration、Hono posts 路由、React PostDetail。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-28-neighbor-help-comment-replies-pin-design.md`
- 不提交 git 除非用户要求

---

### Task 1: Migration + schema

- Create: `worker/migrations/0012_comment_replies_pin.sql`
- Modify: `worker/schema.sql`
- Apply: `npx wrangler d1 migrations apply neighbor-help-db`（local）

### Task 2: Worker APIs

- Modify: `posts.js`（计数、顶评嵌套 replies、reply CRUD、pin/unpin、删帖/删评级联）
- Modify: `reports.js` 允许 `reply`
- Modify: `logger.js` 路由描述

### Task 3: Frontend

- Modify: `api.js`、`PostDetail.jsx`

### Task 4: Verify

- `npm test`（worker）、`npm run lint` && `build`（frontend）
