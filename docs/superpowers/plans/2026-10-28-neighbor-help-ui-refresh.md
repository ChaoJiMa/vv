# 邻里里全站 UI 焕新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用自建 `components/ui/` + CSS Token 完成全站活泼插画风换肤、明暗主题与交互增强，不改后端。

**Architecture:** `tokens.css` + `ThemeProvider` 写 `data-theme`；页面只拼 ui 组件；MUI 仅图标；按迁移分期逐页替换。

**Tech Stack:** React 19、Vite、现有 React Query / react-router、CSS 变量、可选保留 `@mui/icons-material`；验证以 `npm run lint` / `npm run build` 为主（前端无 vitest）。

## Global Constraints

- 不改 `neighbor-help/worker` API 契约与路由 path
- 主色 light `#EC6E33`，页面禁止散落写死色值（token 文件除外）
- 主题偏好键 `localStorage['nh-theme']` = `light|dark|system`
- 尊重 `prefers-reduced-motion`
- 可点热区目标 ≥ 44px
- 每 Task 结束后在 `neighbor-help/frontend` 跑通 `npm run lint` 与 `npm run build`

## File map

| 路径 | 职责 |
|------|------|
| `frontend/src/styles/tokens.css` | 明暗 CSS 变量 |
| `frontend/src/theme/themeMode.js` | 读写偏好、解析有效主题 |
| `frontend/src/theme/ThemeProvider.jsx` | Context + 写 `data-theme` |
| `frontend/src/components/ui/*` | 设计系统组件 |
| `frontend/src/index.css` / `App.jsx` / `main.jsx` | 引入 token 与 ThemeProvider |
| `frontend/src/pages/*.jsx` | 逐页换皮与交互 |
| `frontend/src/components/BottomNav.jsx` 等 | 迁入 ui 或改为再导出 |

---

### Task 1: Token + 主题解析

**Files:**
- Create: `neighbor-help/frontend/src/styles/tokens.css`
- Create: `neighbor-help/frontend/src/theme/themeMode.js`
- Create: `neighbor-help/frontend/src/theme/ThemeProvider.jsx`
- Modify: `neighbor-help/frontend/src/index.css`（`@import` tokens）
- Modify: `neighbor-help/frontend/src/main.jsx` 或 `App.jsx`（包 `AppThemeProvider`）
- Modify: `neighbor-help/frontend/src/App.jsx`（去掉或弱化 MUI 绿主色依赖页面布局；可留 MUI Theme 给图标无关紧要）

**Interfaces:**
- Produces: `getStoredMode()`, `setStoredMode(mode)`, `resolveTheme(mode, systemDark)`, `AppThemeProvider`, `useAppTheme()` → `{ mode, theme, setMode }`

- [ ] **Step 1: 添加 `tokens.css`**

```css
:root, [data-theme="light"] {
  --color-primary: #EC6E33;
  --color-primary-pressed: #D85F26;
  --color-accent-mint: #7BC9A6;
  --color-accent-sky: #6BB3E0;
  --color-accent-cream: #F0D9A8;
  --color-bg: #FFF8F2;
  --color-bg-accent: #FFE8D6;
  --color-surface: #FFFFFF;
  --color-text: #1C1C1E;
  --color-text-muted: #6C6C70;
  --color-border: rgba(28, 28, 30, 0.08);
  --radius-card: 20px;
  --radius-btn: 14px;
  --nav-height: 72px;
  --font-display: "Kaixin", system-ui, sans-serif;
}

[data-theme="dark"] {
  --color-primary: #F08A52;
  --color-primary-pressed: #EC6E33;
  --color-accent-mint: rgba(123, 201, 166, 0.35);
  --color-accent-sky: rgba(107, 179, 224, 0.35);
  --color-accent-cream: rgba(240, 217, 168, 0.28);
  --color-bg: #1A1614;
  --color-bg-accent: #2A211C;
  --color-surface: #26201C;
  --color-text: #F5F2EF;
  --color-text-muted: #A89F97;
  --color-border: rgba(245, 242, 239, 0.12);
}
```

- [ ] **Step 2: 实现 `themeMode.js`**

```js
export const THEME_KEY = 'nh-theme'
export function getStoredMode() {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}
export function setStoredMode(mode) {
  localStorage.setItem(THEME_KEY, mode)
}
export function resolveTheme(mode, systemDark) {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}
```

- [ ] **Step 3: 实现 `ThemeProvider.jsx`**（监听 `matchMedia('(prefers-color-scheme: dark)')`，`useEffect` 设置 `document.documentElement.dataset.theme`）

- [ ] **Step 4: 在 `index.css` 顶部 `@import './styles/tokens.css';`，`body { background: var(--color-bg); color: var(--color-text); }`；`App` 外包 `AppThemeProvider`**

- [ ] **Step 5: 验证**

Run: `cd neighbor-help/frontend && npm run lint && npm run build`  
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add neighbor-help/frontend/src/styles/tokens.css neighbor-help/frontend/src/theme neighbor-help/frontend/src/index.css neighbor-help/frontend/src/App.jsx neighbor-help/frontend/src/main.jsx
git commit -m "$(cat <<'EOF'
feat(ui): add design tokens and app theme provider

EOF
)"
```

---

### Task 2: 基础 ui 组件

**Files:**
- Create: `neighbor-help/frontend/src/components/ui/AppShell.jsx`
- Create: `neighbor-help/frontend/src/components/ui/Button.jsx`
- Create: `neighbor-help/frontend/src/components/ui/Field.jsx`
- Create: `neighbor-help/frontend/src/components/ui/Sticker.jsx`
- Create: `neighbor-help/frontend/src/components/ui/Skeleton.jsx`
- Create: `neighbor-help/frontend/src/components/ui/index.js`（再导出）

**Interfaces:**
- Consumes: CSS 变量
- Produces: `AppShell({ children, withNav })`, `Button({ variant, loading, children, ...props })`, `Field({ label, error, ... })`, `Sticker({ active, color, children })`, `Skeleton({ height, className })`

- [ ] **Step 1: 实现上述组件**（Button primary 用 `var(--color-primary)`；`active:scale`；`disabled`/`loading`；Field 错误用小型红字；AppShell `maxWidth: 480` 居中，`withNav` 时 `paddingBottom: var(--nav-height)`）

- [ ] **Step 2: lint + build**

- [ ] **Step 3: Commit** `feat(ui): add core ui primitives`

---

### Task 3: PostCard、EmptyState、ListError、Sheet

**Files:**
- Create: `neighbor-help/frontend/src/components/ui/PostCard.jsx`
- Create: `neighbor-help/frontend/src/components/ui/EmptyState.jsx`
- Create: `neighbor-help/frontend/src/components/ui/ListError.jsx`
- Create: `neighbor-help/frontend/src/components/ui/Sheet.jsx`
- Modify: 旧 `components/EmptyState.jsx` / `ListError.jsx` / `BottomSheet.jsx` 改为 re-export ui 版或删除并改 import

**Interfaces:**
- `PostCard({ post, menu, onClick })`
- `EmptyState({ title, action })`
- `ListError({ onRetry })`
- `Sheet({ open, onClose, title, children })` — 行为对齐现有 BottomSheet（遮罩关闭、滑入）

- [ ] **Step 1: 实现并切换 import**
- [ ] **Step 2: lint + build**
- [ ] **Step 3: Commit** `feat(ui): add PostCard Sheet Empty ListError`

---

### Task 4: BottomNav + Fab

**Files:**
- Modify: `neighbor-help/frontend/src/components/BottomNav.jsx`（或迁到 `ui/BottomNav.jsx`）
- Create: `neighbor-help/frontend/src/components/ui/Fab.jsx`

- [ ] **Step 1: 底栏吃 token；选中弹跳；热区 ≥44；中间发帖凸起**
- [ ] **Step 2: lint + build**
- [ ] **Step 3: Commit** `feat(ui): restyle bottom nav and fab`

---

### Task 5: 登录页换肤

**Files:**
- Modify: `neighbor-help/frontend/src/pages/Login.jsx`

- [ ] **Step 1: 品牌英雄区 + 天空渐变 + 表单卡用 ui `Field`/`Button`/`Sheet`；去掉页面内硬编码色常量，改 token**
- [ ] **Step 2: lint + build**
- [ ] **Step 3: Commit** `feat(ui): refresh login page`

---

### Task 6: 首页换肤 + 入口动效

**Files:**
- Modify: `neighbor-help/frontend/src/pages/Home.jsx`

- [ ] **Step 1: AppShell、公告带、2×2 色块入口（微浮动 + reduced-motion 关闭）、PostCard 流、Fab、ListError/Empty/Skeleton**
- [ ] **Step 2: lint + build**
- [ ] **Step 3: Commit** `feat(ui): refresh home with sticker entrances`

---

### Task 7: 发现页

**Files:**
- Modify: `neighbor-help/frontend/src/pages/Discover.jsx`

- [ ] **Step 1: 搜索 Field、Sticker 横滑、PostCard、错误空态**
- [ ] **Step 2: lint + build + commit** `feat(ui): refresh discover page`

---

### Task 8: 发帖 / 编辑

**Files:**
- Modify: `neighbor-help/frontend/src/pages/CreatePost.jsx`

- [ ] **Step 1: 类型色块、Field、图片槽、主按钮 loading、失焦/提交校验与错项滚动**
- [ ] **Step 2: lint + build + commit** `feat(ui): refresh create/edit post`

---

### Task 9: 帖子详情

**Files:**
- Modify: `neighbor-help/frontend/src/pages/PostDetail.jsx`

- [ ] **Step 1: 头图/色块、贴纸、操作按钮层级、联系方式块、评论与 Sheet 确认（若有破坏性操作）**
- [ ] **Step 2: lint + build + commit** `feat(ui): refresh post detail`

---

### Task 10: 消息 + 聊天交互

**Files:**
- Modify: `neighbor-help/frontend/src/pages/Messages.jsx`
- Modify: `neighbor-help/frontend/src/pages/Chat.jsx`

- [ ] **Step 1: 会话行/通知吃 token；聊天气泡；失败重送；`visualViewport` 调整底栏；防连点**
- [ ] **Step 2: lint + build + commit** `feat(ui): refresh messages and chat ux`

---

### Task 11: 我的 + 主题切换 + 公告管理 + 404

**Files:**
- Modify: `neighbor-help/frontend/src/pages/Profile.jsx`
- Modify: `neighbor-help/frontend/src/pages/AnnouncementsManage.jsx`（若存在）
- Modify: `neighbor-help/frontend/src/pages/NotFound.jsx`

- [ ] **Step 1: 头区/统计贴纸；主题 `light|dark|system` 三选一接 `useAppTheme`；退出等用 Sheet 确认；公告管理与 404 换皮**
- [ ] **Step 2: lint + build + commit** `feat(ui): profile theme toggle and remaining pages`

---

### Task 12: 交互收尾

**Files:**
- 按需改 Home/Discover/Messages、ToastProvider、全局 CSS

- [ ] **Step 1: 列表明显「刷新」按钮或等效 refetch；统一骨架；破坏性确认 Sheet 扫尾；检查热区与 reduced-motion**
- [ ] **Step 2: `npm run lint && npm run build`**
- [ ] **Step 3: 手测清单**：登录明暗、首页入口、发帖、详情、聊天键盘、主题三态刷新保留
- [ ] **Step 4: Commit** `feat(ui): polish interactions and refresh affordances`

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| Token / 暗黑 / system | 1, 11 |
| ui 组件层 | 2–4 |
| 各页布局 | 5–11 |
| 交互 1–6 | 8–12（键盘/重送 10，主题 11，刷新/确认 12） |
| reduced-motion | 6, 12 |
| 不改后端 | 全局约束 |
