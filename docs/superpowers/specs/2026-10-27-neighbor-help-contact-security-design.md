# 联系方式与上传安全加固 Design

## 目标

按优先级修复安全审查中的 4 项：① 详情接口缩小 `contact` 可见范围；② 日志脱敏；③ 字段级加密落库；④ 图片 magic bytes + `nosniff`。

## 决策

### 1. 可见范围

`POST /api/posts/detail` 仅在以下情况返回明文 `contact`：

- 当前用户是帖子作者（`myId === post.user_id`），或
- 当前用户已对该帖响应（`myResponded === true`）

游客、仅登录未响应的用户：响应体不含 `contact` 字段。列表接口继续一律剔除。

不包含「仅评论过」——评论门槛过低，易被刷评论采集。

### 2. 日志脱敏

`logger.js` 的 `SENSITIVE_KEYS` 增加 `contact`（请求体 `posts/create|update` 等）。

### 3. 加密落库

- 算法：AES-256-GCM（Web Crypto，与现有 auth 一致不引第三方库）
- 环境变量：`CONTACT_ENC_KEY`（64 位 hex = 32 字节）。本地 `.dev.vars`、生产 Dashboard。
- 密文格式：`enc:v1:<iv_b64url>:<ciphertext+tag_b64url>`
- 写入：校验后的明文经 `encryptContact` 再 INSERT/UPDATE；无 key 时仍写明文（兼容未配密钥的本地环境，但生产应配置）
- 读取：若以 `enc:v1:` 开头则解密；否则视为历史明文原样返回（双读，无需迁移脚本）
- 仅在「可见范围」通过后解密并写入响应

### 4. 图片

- 上传：读文件前若干字节，按 magic 判定 jpeg/png/webp/gif；与声明 MIME 不一致则以 magic 为准（拒绝无法识别）
- 读图响应增加 `X-Content-Type-Options: nosniff`

## 非目标

- 不改「私信交换联系方式」产品形态
- 不做存量行批量 re-encrypt 迁移（双读即可）
- 不改 JWT 存 localStorage

## 验收

- 未响应登录用户调 detail 无 `contact`
- 作者 / 已响应用户可见明文
- 日志中 `contact` 为 `***`
- DB 新写入为 `enc:v1:...`（配置了 key 时）
- 伪 MIME 上传被拒；读图带 nosniff
- `/api/me/posts` 与公开列表一样不含 `contact`

## 部署检查

1. 生产 Workers 环境变量配置 `CONTACT_ENC_KEY`（64 位 hex），与本地 `.dev.vars` 可用不同值，但生产必须存在
2. 部署后抽查：新建帖子的 `posts.contact` 以 `enc:v1:` 开头
3. 若未配 key，新写入仍为明文（设计兼容本地；生产视为未完成加固）
