# Contact Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 缩小 contact 可见范围、日志脱敏、AES-GCM 落库、图片 magic + nosniff。

**Architecture:** 纯函数模块 `contactCrypto.js` / 扩展 `images.js`；`posts/detail` 授权后再解密；logger 增加 `contact` 键。

**Tech Stack:** Cloudflare Worker Web Crypto、Vitest、Hono。

## Global Constraints

- 不引入 npm crypto 依赖；只用 Web Crypto
- contact 可见：仅作者或已响应
- 密文前缀 `enc:v1:`；无 key 时写明文；历史明文双读
- 生产需配置 `CONTACT_ENC_KEY`（64 hex）

---

### Task 1: posts/detail 可见范围

**Files:**
- Modify: `neighbor-help/worker/src/routes/posts.js`（detail handler）
- Test: 若无可独立测 helper，抽 `canSeeContact(myId, postUserId, myResponded)` 到同文件旁或 `contactCrypto.js` 旁的小函数并单测

**Interfaces:**
- Produces: `canSeeContact(myId, authorId, myResponded) -> boolean`

- [x] **Step 1:** 写失败单测：`canSeeContact` 游客/路人 false；作者/已响应 true
- [x] **Step 2:** 实现 helper + 改 detail：不可见时删除 `contact`；可见时保留（Task 3 再接解密）
- [x] **Step 3:** `npm test` 通过

---

### Task 2: logger 脱敏 contact

**Files:**
- Modify: `neighbor-help/worker/src/logger.js`
- Modify: `neighbor-help/worker/test/logger.test.js`

- [x] **Step 1:** 测试 `redact({ contact: '138...' })` → `***`
- [x] **Step 2:** `SENSITIVE_KEYS` 加 `contact`
- [x] **Step 3:** `npm test` 通过

---

### Task 3: contact 字段级加密

**Files:**
- Create: `neighbor-help/worker/src/contactCrypto.js`
- Create: `neighbor-help/worker/test/contactCrypto.test.js`
- Modify: `neighbor-help/worker/src/routes/posts.js`（create/update/detail）
- Modify: `CLAUDE.md`（文档 CONTACT_ENC_KEY）

**Interfaces:**
- `encryptContact(plain, keyHex) -> Promise<string>`
- `decryptContact(stored, keyHex) -> Promise<string>`（非 enc 前缀原样返回；空串安全）

- [x] **Step 1:** 写 encrypt/decrypt roundtrip + legacy plaintext 单测
- [x] **Step 2:** 实现 `contactCrypto.js`
- [x] **Step 3:** create/update 写入前 encrypt；detail 在 canSee 后 decrypt
- [x] **Step 4:** `npm test`；提醒本地 `.dev.vars` 加 `CONTACT_ENC_KEY`

---

### Task 4: 图片 magic + nosniff

**Files:**
- Modify: `neighbor-help/worker/src/images.js`
- Create: `neighbor-help/worker/test/images.test.js`
- Modify: `neighbor-help/worker/src/routes/images.js`

**Interfaces:**
- `detectImageMime(bytes: Uint8Array) -> 'image/jpeg'|...|null`
- `validateImage({ type, size, bytes? })`：有 bytes 时以 magic 为准

- [x] **Step 1:** 单测 jpeg/png/webp/gif magic 与拒绝非图
- [x] **Step 2:** 实现 detect + 改 validateImage；upload 传入 arrayBuffer 切片
- [x] **Step 3:** 读图加 `X-Content-Type-Options: nosniff`
- [x] **Step 4:** `npm test`
