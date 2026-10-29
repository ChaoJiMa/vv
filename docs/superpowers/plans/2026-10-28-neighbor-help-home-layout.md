# Home Sunny Greeting Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 首页改为阳光问候氛围 + 横滑贴纸入口 + 动态列表，去掉统计大卡与 2×2 格。

**Architecture:** 主要改写 `Home.jsx`；公告用一行摘要 + Sheet；复用 MenuSticker / PostCard / Sheet / Fab。

**Tech Stack:** React、现有 UI tokens、inline + 少量局部 CSS。

**Spec:** `docs/superpowers/specs/2026-10-28-neighbor-help-home-layout-design.md`

## Global Constraints

- 仅改首页；不改 API；安全提示仍走帮助 Fab Sheet
- 验证：`npm run lint` + `npm run build`

---

### Task 1: 重写 Home 结构

**Files:** Modify `neighbor-help/frontend/src/pages/Home.jsx`

- [x] 氛围问候区（渐变、品牌、按时问候、小字今日/累计、登录）
- [x] 公告一行 + notices Sheet；删跑马灯与橙色统计卡
- [x] 横向贴纸入口条（轻微主次、热度小字）
- [x] 保留动态列表 / Empty / Fab 安全提示 / BottomNav
- [x] lint + build
