# 发布先选分类 Design

日期：2026-10-28  
状态：已落地  
前置：BottomNav「+」、CreatePost、Sheet / menus

## 目标

点「+」先弹窗选分类，再进发布页；发布页顶部可再开同一弹窗换类。

## 非目标

- 独立选类路由  
- 改后端 menus / create API

## 交互

1. 底栏「+」：登录后打开分类 Sheet，不直接进 `/create`。  
2. Sheet：四类 MenuSticker + label/desc；点一项 → 关闭 → `/create` + `state.type`。  
3. 发布页：去掉四格大选区；顶栏下「当前分类 ▾」点开同一 Sheet 换类。  
4. 无 `type` 进入发布页（如空状态「去发布」）：自动打开换类 Sheet。  
5. 编辑帖：同样顶部换类，不强制先弹窗。

## 实现

- `TypePickSheet`（或内联）：menus + 选中回调  
- `BottomNav`：`+` 改开 Sheet  
- `CreatePost`：收分类 UI；支持 `location.state.type`
