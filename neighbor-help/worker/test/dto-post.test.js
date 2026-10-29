import { describe, it, expect } from 'vitest'
import { serializePost, serializeHelper, serializeResponse } from '../src/dto/post.js'

describe('serializePost', () => {
  const row = {
    id: 'p1',
    user_id: 'u1',
    type: 'help',
    title: '标题',
    content: '内容',
    images: JSON.stringify([{ key: 'a.jpg', width: 100, height: 200 }]),
    status: 'open',
    location: '3栋',
    created_at: 1000,
    nickname: '邻',
    avatar: null,
    building: '3',
    unit: '2',
    comment_count: 2,
    like_count: 5,
    last_reply_at: 2000,
  }

  it('出口含新造型与旧字段双写', () => {
    const dto = serializePost(row, { liked: true, responded: false })
    expect(dto.images).toEqual(['a.jpg'])
    expect(dto.cover).toEqual({ key: 'a.jpg', width: 100, height: 200 })
    expect(dto.author).toEqual({
      id: 'u1', nickname: '邻', avatar: null, building: '3', unit: '2',
    })
    expect(dto.stats).toEqual({ commentCount: 2, likeCount: 5 })
    expect(dto.viewer).toEqual({ liked: true, responded: false })
    expect(dto.createdAt).toBe(1000)
    expect(dto.created_at).toBe(1000)
    expect(dto.like_count).toBe(5)
    expect(dto.my_liked).toBe(true)
    expect(dto.myLiked).toBe(true)
    expect(dto.nickname).toBe('邻')
  })

  it('兼容旧纯 key 数组', () => {
    const dto = serializePost({ ...row, images: '["b.png"]' })
    expect(dto.images).toEqual(['b.png'])
    expect(dto.cover).toEqual({ key: 'b.png' })
  })
})

describe('serializeHelper / serializeResponse', () => {
  it('双写 id 字段', () => {
    expect(serializeHelper({ helper_id: 'h1', thanked: 1, nickname: 'A', building: '1' }))
      .toMatchObject({ helperId: 'h1', helper_id: 'h1', thanked: true })
    expect(serializeResponse({ user_id: 'u2', nickname: 'B', building: '' }))
      .toMatchObject({ userId: 'u2', user_id: 'u2' })
  })
})
