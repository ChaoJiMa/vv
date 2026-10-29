# 邻里里头像上传 Design

日期：2026-10-28  
状态：已落地  
前置：Profile 编辑资料弹窗、现有 `POST /api/upload` + R2、`users.avatar`

## 目标

用户可上传个人头像；主页与编辑弹窗都能进入；选图后先预览，点「保存」才与昵称/楼栋一并写入。

## 非目标

- 客户端裁剪 / 滤镜  
- 专用头像上传接口  
- 立刻保存（不经「保存」）  
- 未保存就关闭弹窗留下的临时上传图（少量孤儿；`reconcile` 仍主要扫帖子图）

## 交互

1. **主页头区**：点头像/昵称 → 打开「编辑资料」弹窗（与现行为一致）。  
2. **编辑弹窗**：顶部可点头像（相机角标）→ 系统选图 → 本地预览；可选「清除头像」。  
3. **保存**：点「保存」才调用 `POST /api/me/update`（含 `avatar`）；取消/关闭丢弃未保存预览与已上传未引用 key（接受少量孤儿）。  
4. 上传中禁用保存；失败 toast，保留原头像预览。

## 数据与 API

- DB：继续用 `users.avatar TEXT`。新上传存 **R2 key**（如 `uuid.jpg`）；历史微信等 **http(s) URL** 仍可读。  
- 上传：复用 `POST /api/upload`（鉴权、限流、类型/大小校验不变）。  
- 更新：扩展 `POST /api/me/update`  
  - 请求可带 `avatar`：  
    - **省略**：不改头像  
    - **`""` / `null`**：清空  
    - **非空**：须通过 `isValidKey`，否则 `INVALID_INPUT`  
  - 与 nickname / building / unit 同一次更新。  
  - 若旧 `avatar` 是合法 R2 key 且与新值不同（含清空），保存后尽力 `IMAGES.delete(旧 key)`；外链旧值不删。  
- 读图：key → `GET /api/img/:key`；外链 URL 原样使用。

## 前端

- 增加 `resolveAvatarUrl(avatar)`（或等价）：空 → 无图；`http(s):` → 原样；否则 `api.imgUrl(key)`。  
- 展示处统一走该函数：Profile 头区、EditProfileForm、PostCard / PostDetail 作者头、Messages 等现有 `avatar` img。  
- `EditProfileForm`：草稿 `avatarKey`（`undefined` = 未改；`null` = 清除；string = 新 key）；保存时按语义组 payload。  
- 选图交互对齐发帖：`input[type=file] accept="image/*"` + `api.uploadImage`。

## 验收

- 弹窗选图预览 → 保存后主页/帖子作者头/私信列表显示新头像。  
- 清除头像 → 保存后回落字母占位。  
- 主页点头像只开弹窗，不直接改库。  
- 非法 key / 未登录上传仍被后端拒绝。  
- 旧外链头像仍能显示。  
- 更换/清除 R2 头像后，旧 key 从对象存储删除（尽力而为）。
