import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

const TYPES = [
  { value: 'help', label: '求助互助', icon: '🙋', desc: '需要邻居帮忙' },
  { value: 'idle', label: '闲置转让', icon: '📦', desc: '转让或免费赠送' },
  { value: 'lost', label: '失物招领', icon: '🔍', desc: '丢东西或捡到东西' },
  { value: 'group', label: '拼单拼团', icon: '🛒', desc: '一起拼外卖或团购' },
]

export default function CreatePost() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [type, setType] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.createPost({ type, title, content }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['posts'] })
      navigate(`/post/${data.id}`)
    },
  })

  const canSubmit = type && title.trim()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto bg-white min-h-screen">
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="text-gray-500">取消</button>
          <span className="font-medium text-gray-800">发布帖子</span>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="text-green-600 font-medium disabled:opacity-40"
          >
            发布
          </button>
        </div>

        <div className="px-4 py-4">
          {/* 类型选择 */}
          <p className="text-sm text-gray-500 mb-3">选择类型</p>
          <div className="grid grid-cols-2 gap-2 mb-6">
            {TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`p-3 rounded-xl border-2 text-left transition-colors ${
                  type === t.value ? 'border-green-500 bg-green-50' : 'border-gray-200'
                }`}
              >
                <span className="text-xl">{t.icon}</span>
                <p className="text-sm font-medium text-gray-800 mt-1">{t.label}</p>
                <p className="text-xs text-gray-400">{t.desc}</p>
              </button>
            ))}
          </div>

          {/* 标题 */}
          <div className="mb-4">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="标题（必填，简洁描述你的需求）"
              maxLength={50}
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-green-400"
            />
          </div>

          {/* 详情 */}
          <div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="补充详情（可选）"
              rows={5}
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-green-400 resize-none"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
