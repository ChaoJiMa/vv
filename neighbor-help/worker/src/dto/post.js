import { parseStoredImages } from '../images.js'

/**
 * 帖子出口 DTO：新造型（camelCase + author/stats/viewer）并双写旧扁平字段。
 * row: DB 行 + join 的 nickname/avatar/... + comment_count/like_count 等
 */
export function serializePost(row, opts = {}) {
  const images = parseStoredImages(row.images)
  const keys = images.map((i) => i.key)
  const first = images[0]
  const cover = first
    ? {
        key: first.key,
        ...(first.width && first.height
          ? { width: first.width, height: first.height }
          : {}),
      }
    : null

  const liked = !!(opts.liked ?? row.my_liked ?? row.myLiked)
  const responded = !!(opts.responded ?? row.myResponded)
  const commentCount = Number(row.comment_count) || 0
  const likeCount = Number(opts.likeCount ?? row.like_count) || 0

  const extensions = { ...(opts.extensions || {}) }
  if (opts.contactUnavailable) extensions.contactUnavailable = true

  const dto = {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content ?? '',
    images: keys,
    cover,
    status: row.status,
    location: row.location || '',
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      nickname: row.nickname || '邻居',
      avatar: row.avatar ?? null,
      building: row.building || '',
      unit: row.unit || '',
    },
    stats: {
      commentCount,
      likeCount,
    },
    viewer: {
      liked,
      responded,
    },
    lastReplyAt: row.last_reply_at ?? null,
    extensions,

    // —— 旧字段双写（deprecated）——
    user_id: row.user_id,
    created_at: row.created_at,
    nickname: row.nickname || '邻居',
    avatar: row.avatar ?? null,
    building: row.building || '',
    unit: row.unit || '',
    comment_count: commentCount,
    like_count: likeCount,
    my_liked: liked,
    myLiked: liked,
    myResponded: responded,
    last_reply_at: row.last_reply_at ?? null,
  }

  if (opts.contact !== undefined) dto.contact = opts.contact
  if (opts.contactUnavailable) dto.contactUnavailable = true
  if (opts.helpers) dto.helpers = opts.helpers
  if (opts.responses) dto.responses = opts.responses
  if (opts.comments) dto.comments = opts.comments

  return dto
}

export function serializeHelper(h) {
  return {
    helperId: h.helper_id,
    thanked: !!h.thanked,
    nickname: h.nickname || '邻居',
    building: h.building || '',
    helper_id: h.helper_id,
  }
}

export function serializeResponse(r) {
  return {
    userId: r.user_id,
    nickname: r.nickname || '邻居',
    building: r.building || '',
    user_id: r.user_id,
  }
}
