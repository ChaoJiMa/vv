import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'

const TABS = [
  { label: '全部', value: '' },
  { label: '求助互助', value: 'help' },
  { label: '闲置转让', value: 'idle' },
  { label: '失物招领', value: 'lost' },
  { label: '拼单拼团', value: 'group' },
]

const TYPE_LABELS = { help: '求助', idle: '闲置', lost: '失物', group: '拼单' }
const TYPE_COLORS = {
  help: 'bg-orange-100 text-orange-600',
  idle: 'bg-blue-100 text-blue-600',
  lost: 'bg-red-100 text-red-600',
  group: 'bg-green-100 text-green-600',
}

export default function Home() {
  const [activeTab, setActiveTab] = useState('')
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['posts', activeTab],
    queryFn: () => api.getPosts(activeTab),
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto bg-white min-h-screen relative pb-20">
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
          <h1 className="text-lg font-semibold text-gray-800">邻里互助</h1>
          <p className="text-xs text-gray-400">小区邻居互帮互助平台</p>
        </div>

        {/* Tab 栏 */}
        <div className="flex overflow-x-auto border-b border-gray-100 px-2">
          {TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.value
                  ? 'border-green-500 text-green-600 font-medium'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 帖子列表 */}
        <div className="divide-y divide-gray-100">
          {isLoading && (
            <div className="text-center py-10 text-gray-400 text-sm">加载中...</div>
          )}
          {!isLoading && posts.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">🏠</p>
              <p className="text-sm">还没有帖子，来发第一条吧</p>
            </div>
          )}
          {posts.map(post => (
            <div
              key={post.id}
              onClick={() => navigate(`/post/${post.id}`)}
              className="px-4 py-3 cursor-pointer active:bg-gray-50"
            >
              <div className="flex items-start gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[post.type]}`}>
                  {TYPE_LABELS[post.type]}
                </span>
                {post.status === 'closed' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">已完成</span>
                )}
              </div>
              <p className="text-sm font-medium text-gray-800 line-clamp-2">{post.title}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                <span>{post.building || ''}{post.unit || ''}邻居</span>
                <span>·</span>
                <span>{formatTime(post.created_at)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 发帖按钮 */}
        <button
          onClick={() => user ? navigate('/create') : navigate('/login')}
          className="fixed bottom-6 right-6 w-14 h-14 bg-green-500 text-white rounded-full shadow-lg text-2xl flex items-center justify-center active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
    </div>
  )
}

function formatTime(ts) {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
