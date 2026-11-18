# 图片绑定及读取协议

- 日期：2026-11-03；调用方为 neighbor-help/frontend/src/api.js。
- 响应成功格式：{ code: 200, message, data }；失败使用业务 code/message；读图直接返回对象。

| 接口 | 参数及鉴权 | 返回和行为 |
|---|---|---|
| POST /api/upload | Bearer token；multipart file，可选 width/height | data 为 key、可选 width/height；R2 元数据记录上传者 |
| POST /api/posts/create | Bearer token；JSON images，其余字段见代码 | data.id；新增图片限本人上传且在 24 小时内，预留一分钟余量 |
| POST /api/posts/update | Bearer token；JSON id/images 等 | data.id；原帖图片可保留；并发更新或删除声明冲突返回 409 |
| POST /api/me/update | Bearer token；JSON avatar 等 | 更新当前用户；已有头像可原位保留；冲突返回 409 |
| GET /api/img/:key?v=2 | 公开；可选 If-None-Match 请求头 | 200 图片，ETag 命中返回 304；已声明删除返回 404/no-store；正常读图 public,no-cache |

图片校验失败返回 IMAGE_INVALID（具体业务码见 response.js）。前端展示 message，不自动重试业务失败。移除引用后检查所有帖子和头像，只有无引用才声明并删除；R2 失败由定时任务重试。旧版强缓存通过 URL v=2 切换，不能撤回客户端已下载的文件。

验证：130 项 Worker 内存回归通过，覆盖绑定权限、清理并发与条件读取；未连接线上存储。升级必须先应用 0014_image_deletions.sql，不能直接重跑可能含删除表语句的历史迁移。
