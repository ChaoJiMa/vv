import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api } from '../api'

const WX_APPID = import.meta.env.VITE_WX_APPID || ''
const REDIRECT_URI = encodeURIComponent(window.location.origin + '/login')

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useAuth()
  const code = params.get('code')

  useEffect(() => {
    if (code) {
      api.loginWithCode(code).then(({ token, user }) => {
        login(token, user)
        navigate('/')
      }).catch(() => navigate('/login'))
    }
  }, [code])

  const handleWxLogin = () => {
    window.location.href =
      `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WX_APPID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=snsapi_userinfo&state=login#wechat_redirect`
  }

  if (code) {
    return <div className="flex justify-center items-center min-h-screen text-gray-400 text-sm">登录中...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <div className="text-center mb-10">
        <p className="text-5xl mb-4">🏘️</p>
        <h1 className="text-xl font-semibold text-gray-800">邻里互助</h1>
        <p className="text-sm text-gray-400 mt-2">小区邻居互帮互助平台</p>
      </div>

      <div className="w-full max-w-xs">
        <button
          onClick={handleWxLogin}
          className="w-full bg-green-500 text-white text-sm font-medium py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <span>微信一键登录</span>
        </button>
        <p className="text-xs text-gray-400 text-center mt-4">
          仅用于识别小区身份，不会获取其他信息
        </p>
      </div>
    </div>
  )
}
