# Sticker Icons + Chunky Line Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四类服务入口换成拟人彩色贴纸；底栏/工具/小尺寸类型标改成加粗手绘线标（同题材）。

**Architecture:** 新增 `MenuSticker`（固定色面 SVG）；重绘 `icons/index.jsx` 中服务线稿与统一 stroke；Home/CreatePost 大入口用贴纸，chip/卡片继续 `MenuIcon`。

**Tech Stack:** React 19、现有 `Svg` 外壳、CSS tokens（贴纸用硬编码品牌色，暗黑略降饱和）。

**Spec:** `docs/superpowers/specs/2026-10-28-neighbor-help-sticker-icons-design.md`

## Global Constraints

- 不引入第三方图标库；不改后端 menus API
- 贴纸不用于 ≤14px 场景；空状态插画本轮不改
- 前端验证：`npm run lint` + `npm run build`

---

### Task 1: MenuSticker 四角色 SVG

**Files:**
- Create: `neighbor-help/frontend/src/components/icons/MenuSticker.jsx`
- Modify: `neighbor-help/frontend/src/components/icons/index.jsx`（export）

**Produces:** `MenuSticker({ type, size=48, className, style })` — type: help|idle|lost|group

- [x] 实现四角色色面 SVG（64 视口，固定色）
- [x] 从 `icons/index.jsx` re-export
- [x] Home 入口、CreatePost 分类大格改用 `MenuSticker`

### Task 2: 服务线稿 + 全局加粗

**Files:**
- Modify: `neighbor-help/frontend/src/components/icons/index.jsx`
- Modify: `neighbor-help/frontend/src/components/icons/svg.jsx`（若需）

- [x] strokeWidth 提到 ~2.25–2.5
- [x] Help/Idle/Lost/Group 改为太阳/纸箱/钥匙/购物袋线稿
- [x] 底栏与通用/通知图标统一加粗（隐喻不变）

### Task 3: 验收

- [x] `npm run lint` / `npm run build` 通过
- [ ] 目视：首页贴纸可辨、Discover chip 仍为线标（待你本地确认）
