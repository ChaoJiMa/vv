# 邻里里线标与空状态插画 Design

日期：2026-10-28

## 目标

在现有阳光小区 UI 上，用**自绘精致线性 SVG**替换 emoji / 普通 MUI 观感，并为空状态提供**简化场景插画**；全站统一，不改后端契约。

## 非目标

- 不引入 Lucide/Phosphor 等第三方图标库作主视觉
- 不做复杂多角色大场景插画
- 不改 menus API；后端 `icon` emoji 可保留，前端展示忽略

## 风格

- 描边约 1.75–2px，圆角线帽，少填充
- 默认 `currentColor`；选中/强调用 `--color-primary` 或浅色底 + 主色线
- 暗色自动跟随 token
- 尊重 `prefers-reduced-motion`（插画无循环大动画）

## 资产

### `src/components/icons/`

统一 props：`size`（默认 24）、`className`、`style`、继承 `currentColor`。

| 组 | 组件 |
|----|------|
| 服务 | `HelpIcon` `IdleIcon` `LostIcon` `GroupIcon` |
| 底栏 | `NavHomeIcon` `NavDiscoverIcon` `NavMessageIcon` `NavMeIcon` `NavAddIcon` |
| 通用 | `BackIcon` `CloseIcon` `SearchIcon` `RefreshIcon` `SendIcon` `CopyIcon` `FlagIcon` `ChevronIcon` `ImageIcon` |
| 通知 | `NotiCommentIcon` `NotiRespondIcon` `NotiAdoptIcon` `NotiThankIcon` |

`getMenuIcon(type)`：`help|idle|lost|group` → 对应服务图标。

### `src/components/illustrations/`

| 组件 | 场景 |
|------|------|
| `EmptyPosts` | 无动态 / 无分类帖 |
| `EmptySearch` | 搜索无结果 |
| `EmptyMessages` | 无私信 |
| `EmptyNotices` | 无通知 / 无公告 |
| `EmptyLost` | 404 |

### `EmptyState`

新增 `illustration`（ReactNode）；有则优先于 `emoji`。

## 页面替换

- 底栏：自有 Nav* 替换 MUI 导航图标
- 首页/发现/发帖/详情：服务类用 `getMenuIcon`
- 消息通知：Noti* 替换 emoji
- 登录徽标：线标或小楼简化 SVG
- 空状态：上述插画
- 通用操作：Back/Close/Search/Copy/Flag/Send/Chevron/Image/Refresh

## 验收

- 主路径无明显 emoji 服务图标残留（通知/空状态除外若未替换完）
- 明暗主题下图标清晰
- lint + build 通过
