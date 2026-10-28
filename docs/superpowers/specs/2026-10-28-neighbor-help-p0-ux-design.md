# P0 UX 三项优化 Design

## 范围

1. 忘记密码改为纯说明（无假提交）
2. Home / Discover / Messages / Chat 列表失败可重试
3. Chat：轮询 8s、乐观发送、减少无效 invalidate

## 非目标

自助重置接口、举报后台、DB 索引、UI 壳组件大重构。

## 细节

### 忘记密码
BottomSheet 仅说明「暂不支持自助重置，请联系小区管理员」+「我知道了」关闭；去掉用户名输入与 submit。

### 错误态
`isError` 时展示文案 +「重试」调用 `refetch`/`refetchPage`；空列表仅在 `!isLoading && !isError && length===0`。

### 聊天
- `refetchInterval` 可见时 8000ms
- `onMutate` 乐观插入临时消息并清空输入；`onError` 回滚并恢复输入；`onSuccess` invalidate thread/conversations/unread
- 去掉「每次 data 变化都 invalidate unread」的 effect，改为发送成功与（可选）轮询结果含新消息时再刷
