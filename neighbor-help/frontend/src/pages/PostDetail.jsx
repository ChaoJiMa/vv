import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

const TYPE_LABELS = { help: '求助互助', idle: '闲置转让', lost: '失物招领', group: '拼单拼团' }

export default function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [comment, setComment] = useState('')

  const { data: post, isLoading } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
  })

  const commentMutation = useMutation({
    mutationFn: () => api.addComment(id, comment),
    onSuccess: () => {
      setComment('')
      qc.invalidateQueries({ queryKey: ['post', id] })
    },
  })

  const closeMutation = useMutation({
    mutationFn: () => api.closePost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['post', id] }),
  })

  if (isLoading) return <div className="flex justify-center py-20 text-gray-400 text-sm">加载中...</div>
  if (!post) return <div className="flex justify-center py-20 text-gray-400 text-sm">帖子不存在</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto bg-white min-h-screen pb-24">
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-500 text-lg">←</button>
          <span className="font-medium text-gray-800">{TYPE_LABELS[post.type]}</span>
          {post.status === 'closed' && (
            <span className="ml-auto text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">已完成</span>
          )}
        </div>

        {/* 帖子内容 */}
        <div className="px-4 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800 mb-2">{post.title}</h2>
          {post.content && <p className="text-sm text-gray-600 leading-relaxed mb-3">{post.content}</p>}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{post.building || ''}{post.unit || ''}邻居 · {post.nickname}</span>
            {user && user.id === post.user_id && post.status === 'open' && (
              <button
                onClick={() => closeMutation.mutate()}
                className="text-green-600 font-medium"
              >
                标记完成
              </button>
            )}
          </div>
        </div>

        {/* 评论列表 */}
        <div className="px-4 py-3">
          <p className="text-xs text-gray-400 mb-3">共 {post.comments?.length || 0} 条回复</p>
          {post.comments?.map(c => (
            <div key={c.id} className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-700">{c.nickname}</span>
                <span className="text-xs text-gray-300">{c.building || ''}</span>
              </div>
              <p className="text-sm text-gray-600">{c.content}</p>
            </div>
          ))}
        </div>

        {/* 评论输入框 */}
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-white border-t border-gray-100 px-4 py-3 flex gap-2">
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={user ? '写下你的回复...' : '登录后才能回复'}
            disabled={!user}
            className="flex-1 text-sm bg-gray-100 rounded-full px-4 py-2 outline-none"
          />
          <button
            onClick={() => user ? commentMutation.mutate() : navigate('/login')}
            disabled={user && !comment.trim()}
            className="bg-green-500 text-white text-sm px-4 py-2 rounded-full disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
