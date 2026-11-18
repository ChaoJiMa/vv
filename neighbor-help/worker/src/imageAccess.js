import { isValidKey } from './images.js'

// 新绑定只接受宽限期内的上传；已绑定的历史图片可在原位置保留。
export const IMAGE_GRACE_MS = 24 * 60 * 60 * 1000

// 校验新增 key 的上传者和时效，原位置保留的 key 不重复限制时效；返回 ok/message。
export async function validateImageAttachments(env, userId, keys, retainedKeys = []) {
  const retained = new Set(retainedKeys)
  for (const key of new Set(keys)) {
    if (!isValidKey(key)) return { ok: false, message: '图片无效，请重新上传' }
    if (retained.has(key)) continue
    const object = await env.IMAGES?.head(key)
    if (!object || object.customMetadata?.ownerId !== userId) {
      return { ok: false, message: '只能使用自己上传的图片，请重新上传' }
    }
    const uploadedAt = new Date(object.uploaded).getTime()
    // 提前一分钟停止新增绑定，为正在提交的请求留出清理安全余量。
    if (!Number.isFinite(uploadedAt) || Date.now() - uploadedAt >= IMAGE_GRACE_MS - 60_000) {
      return { ok: false, message: '图片上传已过期，请重新上传' }
    }
  }
  return { ok: true }
}
