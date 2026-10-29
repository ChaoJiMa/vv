# 邻里里消息页分段 Tab 布局 Design

日期：2026-10-28  
状态：已落地（方案 1：就地改 Messages 顶栏）  
前置：私信按帖拆会话（`2026-10-28-neighbor-help-dm-per-post-conversation-design.md`）

## 目标

消息页顶栏改为类微信的「私信 | 通知」分段控件；进入时按未读优先落到对应 Tab。

## 非目标

- 不拆路由 / 不改 BottomNav / 不改 Chat 页
- 不抽全局 Segmented 组件
- 不改私信/通知列表行内容逻辑

## 决策

| 项 | 选择 |
|----|------|
| 结构 | 保留单页双 Tab，顶栏分段条 |
| 默认 Tab | 私信未读 > 0 → 私信；否则通知未读 > 0 → 通知；否则私信 |
| 切换 | 仅首次根据 unread 设初值；之后手动切换不被轮询改写 |
| 角标 | 分段上展示 messageUnread / notiUnread；0 隐藏；>99 → 99+ |

## UI

1. 顶栏第一行：标题「消息」+ 刷新  
2. 第二行：全宽圆角轨道，两段均分「私信」「通知」；选中主色底 + on-primary 字色  
3. 列表区保持现有私信/通知渲染

## 实现范围

- `neighbor-help/frontend/src/pages/Messages.jsx` 为主（可去掉对本页 Sticker Tab 的依赖）
