# 发布先选分类 Implementation Plan

**Goal:** 「+」先弹分类 Sheet，再进发布页；页内顶部可换类。

### Task 1
- 新增 `TypePickSheet` 组件（Sheet + menus 网格）
- BottomNav「+」打开 Sheet，选中后 `navigate('/create', { state: { type } })`

### Task 2
- CreatePost：去掉四格分类；顶部当前分类行；换类 Sheet；无 type 时自动打开
