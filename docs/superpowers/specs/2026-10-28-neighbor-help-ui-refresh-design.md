# 邻里里全站 UI 焕新 Design

日期：2026-10-28

## 目标

在**不改后端契约与路由信息架构**的前提下，将前端从「基础 MUI 模板感」升级为：

- 视觉：**活泼插画风**（色块积木、贴纸标签、插画感空状态）
- 配色：**阳光小区**（暖橙主色 + 薄荷绿 / 天蓝 / 米黄辅色）
- 动效：**B 档有趣**（错落入场、按压缩放、底栏弹跳、入口微浮动；尊重 `prefers-reduced-motion`）
- 主题：**明 / 暗 / 跟随系统**（`localStorage` 覆盖）
- 工程：**方案 3** — 自建 `components/ui/` 为主；MUI 仅图标与极少数难替代控件
- 交互：**反馈、热区、空错、确认 Sheet、键盘避让、防连点、下拉/刷新、聊天重送** 等 1–6 项全做

## 非目标

- 不改 API、鉴权、业务规则
- 不做插画角色循环长动画
- 不新增大业务功能（仅 UI/UX）
- 前端暂不强制引入完整单测框架；以 `npm run lint` + `npm run build` + 主路径手测为准

## 设计系统

### Token（CSS 变量）

挂在 `document.documentElement` 的 `data-theme="light|dark"` 上。

| 角色 | Light | Dark |
|------|-------|------|
| `--color-primary` | `#EC6E33` | 略提亮暖橙（如 `#F08A52`） |
| `--color-primary-pressed` | `#D85F26` | 对应按下色 |
| `--color-accent-mint` / `sky` / `cream` | 高明度辅色 | 同色相、降饱和、可半透明 |
| `--color-bg` | 暖白微渐变底 | 深暖灰（非纯黑）+ 顶微橙晕可选 |
| `--color-surface` | 白/抬升白 | 抬升深灰 |
| `--color-text` / `--color-text-muted` | 近黑 / 中灰 | 近白 / 中亮灰 |
| `--radius-card` / `--radius-btn` | ~20 / ~14 | 同左 |
| 字体 | 标题开心体（已有 subset）+ 系统清晰无衬线正文 | 同左 |

禁止页面散落写死主色；统一从 token / `tokens.css` 引用。

### 主题行为

- 偏好：`light` | `dark` | `system`，存 `localStorage`（键名如 `nh-theme`）
- `system`：跟随 `prefers-color-scheme`，并监听变化
- 「我的」提供三选一；切换即时、避免整页白闪
- `ThemeProvider`（自建）包在应用根，负责解析并写 `data-theme`

### 动效

- 入场错落、按钮/卡片 `active` 缩放、底栏选中弹一下、四类入口慢速微浮动
- `@media (prefers-reduced-motion: reduce)`：取消浮动与弹跳，仅保留淡入或静态

## 组件层 `src/components/ui/`

| 组件 | 职责 |
|------|------|
| `AppShell` | max-width 480、背景、主页底栏占位 |
| `Button` | primary / secondary / ghost + loading + 按压反馈 |
| `IconBtn` | ≥44px 热区 |
| `Field` | 输入、错误文案、配合失焦校验 |
| `Sticker` | 分类/状态标签 |
| `PostCard` | 列表卡片 |
| `BottomNav` / `Fab` | 导航与发帖（可自 `components/BottomNav.jsx` 迁入） |
| `Sheet` | 替代生硬 confirm；注册/忘记密码等底部层 |
| `EmptyState` / `ListError` / `Skeleton` | 空、错、骨架 |
| Toast | 沿用现有 toast，样式吃 token |

页面以拼装 ui 为主，不再用 MUI `Box`/`Button`/`Chip` 做版式骨架。现有 `BottomSheet` / `EmptyState` / `ListError` 迁入或包一层吃 token，避免双皮。

## 页面布局（摘要）

- **登录**：品牌英雄级 + 天空色块底 + 表单贴纸卡；Sheet 注册/忘记密码
- **首页**：公告色带 + 2×2 四类色块入口（微浮动）+ `PostCard` 流 + FAB
- **发现**：胶囊搜索 + 横向 Sticker + 列表
- **发帖/编辑**：类型大色块单选 + Field + 图片虚线槽 + 通栏主按钮
- **详情**：图/色块头 + 贴纸 + 操作主次分明 + 联系方式提示块 + 评论与底输入
- **消息/聊天**：会话行未读点；气泡左右异色；乐观发送；失败可重送；输入键盘避让
- **我的**：色块头区 + 统计贴纸 + 列表 + **主题三选一**
- **公告管理 / 404**：同一套列表与空状态语言

详细结构见会话设计第 2 节加详版；实现以该层级为准。

## 交互（全做）

1. **反馈**：主按钮 loading/成功失败；列表可刷新；复制/发送有即时反馈
2. **少打断**：游客入口提示并回跳；破坏性操作用 Sheet 确认
3. **热区**：可点 ≥44px；分类横滑；聊天 `visualViewport` 避让键盘
4. **容错**：统一骨架/空/错；表单失焦+提交校验，错项滚入视野；防连点；聊天失败重送
5. **动效 B 档** + reduced-motion
6. **暗黑**：对比足够；主题切换不闪白

下拉刷新：若原生下拉在桌面/WebView 不稳，采用「明显刷新控件 + refetch」作为可接受实现，计划中锁定一种。

## 迁移分期

1. Token + ThemeProvider + 暗黑切换（我的可先暴露）
2. ui 基础组件
3. 登录 → 首页 → 发现 → 发帖 → 详情
4. 消息/聊天 → 我的 → 公告管理/404
5. 交互补齐（刷新、Sheet 确认、键盘、重送、骨架）
6. `lint` + `build` + 明暗主路径手测

每期应可独立构建通过。

## 验收

- 三态主题正确，刷新后偏好保留
- 主路径（登录、浏览、发帖、详情、消息、我的）视觉与反馈符合本设计
- reduced-motion 下无大位移循环动画
- 后端与路由行为无回归

## 风险

- 改动面大：按页替换、勤构建
- 方案 3 工期长：优先 ui 与壳，再逐页
- 下拉刷新兼容性：优先稳妥刷新入口
