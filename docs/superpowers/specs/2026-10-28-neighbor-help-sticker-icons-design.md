# 邻里里拟人贴纸 + 手绘线标 Design

日期：2026-10-28  
状态：已确认（对话分节 §1–§3）

## 目标

在现有「阳光小区」UI 上，把偏通用工具感的细线标升级为：

1. **四类服务入口**：彩色拟人贴纸（活泼、好认）
2. **底栏 / 工具 / 小尺寸类型标**：加粗手绘线标（清晰、跟主题色）

不改后端契约；不引入第三方图标库。

## 非目标

- 空状态插画本轮不改
- 底栏不做贴纸化
- 不做线标抖动动画、复杂表情动画
- 不改 menus API；后端 `icon` emoji 可保留，前端展示忽略

## 风格总则

| 层 | 手法 | 颜色 |
|----|------|------|
| 入口贴纸 | 色面填充 + 简化拟人 + 1 道具 | **固定色**（暗黑略降饱和，不反相成线标） |
| 线标 | 描边约 2.25–2.5，圆角线帽，路径简化 | `currentColor` + 现有 `filled` |

与上一版线标 spec（`2026-10-28-neighbor-help-icons-illustrations-design.md`）关系：本 spec **覆盖**服务类图标的视觉与用法；空状态插画仍以旧 spec 为准。

## 贴纸角色（MenuSticker）

视口约 `0 0 64 64`。展示尺寸建议：首页入口 ~40–48px；发帖类型选择 ~32px。

| type | 角色 | 主色 | 识别点（小尺寸只保留这些） |
|------|------|------|---------------------------|
| help | 小太阳邻居 | 暖黄底 + 橙描边 | 圆脸太阳 + 小手臂「帮忙」势 |
| idle | 纸箱小人 | 奶油 / 纸箱棕 | 开盖纸箱身 + 两点眼 + 伸出的小手 |
| lost | 钥匙精灵 | 薄荷绿底 | 钥匙身形 + 小翅膀或高光 + 圆脸 |
| group | 购物袋小人 | 天空蓝底 | 竖袋身 + 提手像耳朵 + 笑脸 |

组件建议：`src/components/icons/MenuSticker.jsx`（或 `stickers/`），props：`type`、`size`、`className`、`style`。

## 线标（重绘 / 加粗）

### 服务类（与贴纸同题材的简化线稿）

`HelpIcon` / `IdleIcon` / `LostIcon` / `GroupIcon` / `MenuIcon`：太阳、纸箱、钥匙、购物袋线稿，供 chip / 卡片角标 / 详情小标签使用。

### 底栏

`NavHomeIcon` `NavDiscoverIcon` `NavMessageIcon` `NavMeIcon` `NavAddIcon`：隐喻不变（家 / 放大镜 / 气泡 / 人 / 加号），统一加粗手绘感；保留 `filled`。

### 通用与通知

`Back` `Close` `Search` `Refresh` `Send` `Copy` `Flag` `Chevron` `Image` 及 `Noti*`：隐喻不变，只统一描边与圆角。

外壳仍用 `svg.jsx` + `currentColor`。

## 替换范围

| 场景 | 资产 |
|------|------|
| 首页四类入口、发帖类型大选择 | **MenuSticker** |
| 发现 chip、PostCard 角标、详情小标签 | **MenuIcon** 线稿 |
| 底栏、通用操作、通知图标 | 加粗手绘线标 |
| 空状态插画 | 不改 |

## 验收

- 首页四个角色一眼可区分
- 明暗主题下贴纸不刺眼、线标可辨
- 小尺寸（≤14px）类型标不糊（用线标而非贴纸）
- `npm run lint` 与 `npm run build`（frontend）通过

## 实现提示

- 先实现四个贴纸 SVG + `MenuSticker`，接到 Home / CreatePost 大入口
- 再重绘四类 `*Icon` 线稿与底栏/工具加粗
- 发现 / PostCard / Detail 小标继续走 `MenuIcon`，勿误换成贴纸
