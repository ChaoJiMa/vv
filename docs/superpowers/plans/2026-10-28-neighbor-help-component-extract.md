# 组件封装（方案 C）实现计划

## 目标

把首页 / 发现 / 我的里重复的「瀑布加载态 + 空错态 + 触底加载」和首页顶区抽成可复用组件，页面只保留数据与跳转。

## 新增文件

| 文件 | 职责 |
|------|------|
| `hooks/useInfiniteScroll.js` | IntersectionObserver 触底 |
| `components/ui/WaterfallSkeleton.jsx` | 双列暖色骨架 |
| `components/ui/PostFeed.jsx` | loading / error / empty / Waterfall / sentinel |
| `components/ui/StickyHeader.jsx` | sticky + safe-top 顶栏壳 |
| `components/ui/CategoryStrip.jsx` | 分类贴纸横滑（入口 / 筛选） |
| `components/ui/SectionHeader.jsx` | 区块标题 + 右侧操作 |
| `components/home/HomeTop.jsx` | 品牌 + 公告条 + 分类（统一渐变带） |

## 接入

- `Home.jsx` → HomeTop + SectionHeader + PostFeed
- `Discover.jsx` → StickyHeader + CategoryStrip + PostFeed
- `Profile.jsx` → PostFeed（Tab/头区保持）

## 验收

- `npm run lint` 通过
- 视觉与交互与封装前一致（骨架仍为暖色低对比）
