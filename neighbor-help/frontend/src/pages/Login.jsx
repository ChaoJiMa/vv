import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { NavHomeIcon } from '../components/icons'
import SplitText from '../components/SplitText'
import AnimatedContent from '../components/AnimatedContent'
import BottomSheet from '../components/BottomSheet'
import { useAuth } from '../hooks/useAuth'
import { api } from '../api'
import { toast } from '../toast'
import { digitsOnly } from '../utils/residence'

const WX_APPID = import.meta.env.VITE_WX_APPID || ''
const REDIRECT_URI = encodeURIComponent(window.location.origin + '/login')
const WARM = 'var(--color-primary)'
const WARM_DARK = 'var(--color-primary-pressed)'
const WARM_FILL = 'var(--color-bg-accent)'

const footLinkSx = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  font: 'inherit',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  '&:active': { opacity: 0.6 },
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
}

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { login, user } = useAuth()
  const code = params.get('code')

  const from = location.state?.from
    ? location.state.from.pathname + (location.state.from.search || '')
    : '/'
  const goAfterAuth = () => navigate(from, { replace: true })

  useEffect(() => {
    if (user) goAfterAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [sheet, setSheet] = useState(null)
  const closeSheet = () => setSheet(null)

  const [reg, setReg] = useState({ username: '', password: '', confirm: '', nickname: '', building: '', unit: '' })
  const [regSubmitting, setRegSubmitting] = useState(false)
  const setRegField = (k) => (e) => setReg(r => ({ ...r, [k]: e.target.value }))
  const setRegDigits = (k) => (e) => setReg(r => ({ ...r, [k]: digitsOnly(e.target.value) }))

  // 首帧锁定高度；仅横竖屏切换时更新，避免工具栏伸缩把布局顶飞
  const [lockedH, setLockedH] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 0
  )
  useEffect(() => {
    // iOS 在 orientationchange 当下 innerHeight 常仍是旧值，稍后再读
    let t
    const onOrient = () => {
      clearTimeout(t)
      t = setTimeout(() => setLockedH(window.innerHeight), 280)
    }
    window.addEventListener('orientationchange', onOrient)
    return () => {
      clearTimeout(t)
      window.removeEventListener('orientationchange', onOrient)
    }
  }, [])
  const pageMinH = lockedH ? `${lockedH}px` : '100dvh'

  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    let raf1, raf2, timer
    const reveal = () => {
      if (cancelled) return
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => { if (!cancelled) setReady(true) })
      })
    }
    if (document.fonts && document.fonts.load) {
      const cached = document.fonts.check?.('40px "KaiXinTi"')
      Promise.all([
        document.fonts.load('40px "KaiXinTi"'),
        document.fonts.load('14px "KaiXinTi"'),
      ]).then(reveal, reveal)
      // 字体已缓存：更快放行；否则最多等 1s
      timer = setTimeout(reveal, cached ? 280 : 1000)
    } else {
      reveal()
    }
    return () => {
      cancelled = true
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      if (timer) clearTimeout(timer)
    }
  }, [])

  const exchanged = useRef(false)
  useEffect(() => {
    if (code && !exchanged.current) {
      exchanged.current = true
      api.loginWithCode(code).then(({ token, user }) => {
        login(token, user)
        goAfterAuth()
      }).catch(() => navigate('/login', { replace: true }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, login, navigate])

  useEffect(() => {
    const prevBgColor = document.body.style.backgroundColor
    const prevOverscroll = document.body.style.overscrollBehavior
    document.body.style.backgroundColor = 'var(--color-bg)'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.backgroundColor = prevBgColor
      document.body.style.overscrollBehavior = prevOverscroll
    }
  }, [])

  const handleLogin = async (e) => {
    e?.preventDefault()
    if (!username.trim() || !password || submitting) return
    setSubmitting(true)
    try {
      const { token, user } = await api.loginWithPassword({ username: username.trim(), password })
      login(token, user)
      goAfterAuth()
    } catch {
      // 错误已由 api 层 toast
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegister = async (e) => {
    e?.preventDefault()
    if (regSubmitting) return
    const regName = reg.username.trim()
    if (!/^[a-zA-Z0-9]{4,20}$/.test(regName)) {
      toast.error('用户名需为4-20位字母或数字')
      return
    }
    if (reg.password.length < 8) {
      toast.error('密码至少8位')
      return
    }
    if (reg.password !== reg.confirm) {
      toast.error('两次输入的密码不一致')
      return
    }
    setRegSubmitting(true)
    try {
      const { token, user } = await api.register({
        username: regName,
        password: reg.password,
        nickname: reg.nickname.trim(),
        building: digitsOnly(reg.building),
        unit: digitsOnly(reg.unit),
      })
      login(token, user)
      toast.success('注册成功，欢迎加入邻里里')
      goAfterAuth()
    } catch {
      // 错误已 toast
    } finally {
      setRegSubmitting(false)
    }
  }

  const handleWxLogin = () => {
    if (!WX_APPID) return
    window.location.href =
      `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WX_APPID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=snsapi_userinfo&state=login#wechat_redirect`
  }

  const openProtocol = (name) => {
    toast.info(`${name}即将上线`)
  }

  if (code) {
    return (
      <Box
        sx={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          minHeight: '100dvh', gap: 1.25,
          bgcolor: 'var(--color-bg)', color: 'var(--color-text-muted)',
        }}
      >
        <CircularProgress size={20} sx={{ color: WARM }} />
        登录中…
      </Box>
    )
  }

  const fieldSx = {
    '& .MuiInput-root': { fontSize: 16, color: 'var(--color-text)' },
    '& label': { fontSize: 15, color: 'var(--color-text-muted)' },
    '& label.Mui-focused': { color: WARM },
    '& .MuiInput-root:before': { borderBottomColor: 'var(--color-border)' },
    '& .MuiInput-root:hover:not(.Mui-disabled):before': { borderBottomColor: 'var(--color-text-muted)' },
    '& .MuiInput-root::after': { borderBottomColor: WARM },
  }

  const fieldGroupSx = { display: 'flex', flexDirection: 'column', gap: 1.25 }
  const sheetFieldSx = {
    '& .MuiFilledInput-root': {
      bgcolor: WARM_FILL, borderRadius: '10px', fontSize: 16, color: 'var(--color-text)', overflow: 'hidden',
      '&:hover': { bgcolor: WARM_FILL },
      '&.Mui-focused': { bgcolor: WARM_FILL },
      '&::before, &::after': { display: 'none' },
    },
    '& .MuiFilledInput-input': { pt: '22px', pb: '7px', height: 27 },
    '& label': { fontSize: 14, color: 'var(--color-text-muted)', transform: 'translate(12px, 20px) scale(1)' },
    '& label.MuiInputLabel-shrink': { transform: 'translate(12px, 7px) scale(0.82)' },
    '& label.Mui-focused': { color: WARM },
  }
  const sheetPrimaryBtn = {
    width: '100%', height: 50, borderRadius: '12px', fontSize: 16, fontWeight: 600,
    bgcolor: WARM, color: 'var(--color-on-primary)', boxShadow: 'none',
    '&:hover': { bgcolor: WARM_DARK, boxShadow: 'none' },
    '&.Mui-disabled': { bgcolor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)', color: 'var(--color-on-primary)' },
  }

  return (
    <Box sx={{ position: 'relative', minHeight: pageMinH, bgcolor: 'var(--color-bg)', overflow: 'hidden', color: 'var(--color-text)' }}>
      <Box
        sx={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(180deg, var(--color-bg-accent) 0%, var(--color-bg) 100%)',
          overflow: 'hidden',
          '@keyframes blobA': {
            '0%, 100%': { transform: 'translate(0, 0) scale(0.95)', opacity: 0.34 },
            '50%': { transform: 'translate(6%, 7%) scale(1.18)', opacity: 0.55 },
          },
          '@keyframes blobB': {
            '0%, 100%': { transform: 'translate(0, 0) scale(1.15)', opacity: 0.52 },
            '50%': { transform: 'translate(-7%, 5%) scale(0.92)', opacity: 0.32 },
          },
          '@keyframes blobC': {
            '0%, 100%': { transform: 'translate(0, 0) scale(0.92)', opacity: 0.3 },
            '50%': { transform: 'translate(-5%, -8%) scale(1.16)', opacity: 0.5 },
          },
          '@media (prefers-reduced-motion: reduce)': {
            '& > span': { animation: 'none !important', opacity: 0.4 },
          },
          '& > span': { position: 'absolute', borderRadius: '50%', filter: 'blur(48px)' },
        }}
      >
        <Box component="span" sx={{ width: '80%', height: '65%', top: '-28%', left: '-28%', bgcolor: 'color-mix(in srgb, var(--color-primary) 55%, transparent)', animation: 'blobA 6.3s ease-in-out infinite', animationDelay: '-1.2s' }} />
        <Box component="span" sx={{ width: '55%', height: '48%', top: '-16%', right: '-24%', bgcolor: 'color-mix(in srgb, var(--color-accent-cream, #F0D9A8) 70%, transparent)', animation: 'blobB 7.7s ease-in-out infinite', animationDelay: '-3.5s' }} />
        <Box component="span" sx={{ width: '70%', height: '55%', bottom: '-28%', right: '-26%', bgcolor: 'color-mix(in srgb, var(--color-accent-mint, #7BC9A6) 45%, transparent)', animation: 'blobC 5.4s ease-in-out infinite', animationDelay: '-4.6s' }} />
      </Box>
      <Box sx={{ position: 'absolute', inset: 0, zIndex: 0, bgcolor: 'color-mix(in srgb, var(--color-bg) 8%, transparent)' }} />

      <Box
        sx={{
          position: 'relative', zIndex: 1,
          minHeight: pageMinH, maxWidth: 480, mx: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'flex-end', px: 3,
          pb: 'calc(20px + var(--safe-bottom))',
        }}
      >
        <AnimatedContent distance={24} duration={0.7} delay={0} start={ready}>
          <Box
            sx={{
              width: 64, height: 64, borderRadius: '20px', mb: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(145deg, #FFB067 0%, #FF8A6B 100%)',
              boxShadow: '0 8px 24px rgba(255,138,107,0.35)',
            }}
          >
            <NavHomeIcon size={34} style={{ color: '#fff' }} filled />
          </Box>
        </AnimatedContent>
        <SplitText
          text="邻里里"
          delay={240}
          duration={1.1}
          start={ready}
          sx={{ fontFamily: '"KaiXinTi", system-ui, sans-serif', color: 'var(--color-text)', fontSize: 40, fontWeight: 400, letterSpacing: 4, mb: 1 }}
        />
        <SplitText
          text="邻里里 · 远亲不如近邻"
          delay={45}
          duration={0.7}
          startDelay={1100}
          start={ready}
          sx={{ fontFamily: '"KaiXinTi", system-ui, sans-serif', color: 'var(--color-text-muted)', fontSize: 14, letterSpacing: 2, mb: 4 }}
        />

        <AnimatedContent distance={28} duration={0.7} delay={1280} start={ready} sx={{ width: '100%' }}>
          <Box
            component="form"
            onSubmit={handleLogin}
            sx={{
              width: '100%',
              bgcolor: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--color-border)',
              px: 2.25, py: 1.75,
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <TextField
              value={username}
              onChange={e => setUsername(e.target.value)}
              label="用户名"
              variant="standard"
              fullWidth
              autoComplete="username"
              sx={{ ...fieldSx, mb: 0.75 }}
            />
            <TextField
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              label="密码"
              variant="standard"
              fullWidth
              autoComplete="current-password"
              sx={{ ...fieldSx, mb: 1.5 }}
            />
            <Button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              sx={{
                ...sheetPrimaryBtn,
                height: 44,
                minHeight: 44,
                fontSize: 15,
                fontWeight: 600,
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(236,110,51,0.25)',
                '&:hover': { bgcolor: WARM_DARK, boxShadow: '0 4px 12px rgba(236,110,51,0.25)' },
              }}
            >
              {submitting ? (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} sx={{ color: 'var(--color-on-primary)' }} />
                  登录中
                </Box>
              ) : '登录'}
            </Button>
          </Box>
        </AnimatedContent>

        <AnimatedContent distance={24} duration={0.7} delay={1450} start={ready}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>
            <Box component="button" type="button" onClick={() => setSheet('register')} sx={footLinkSx}>注册</Box>
            <Box component="span" sx={{ opacity: 0.45 }} aria-hidden>·</Box>
            <Box component="button" type="button" onClick={() => setSheet('forgot')} sx={footLinkSx}>忘记密码</Box>
            <Box component="span" sx={{ opacity: 0.45 }} aria-hidden>·</Box>
            {WX_APPID ? (
              <Box component="button" type="button" onClick={() => setSheet('wechat')} sx={footLinkSx}>微信登录</Box>
            ) : (
              <Box
                component="button"
                type="button"
                disabled
                title="微信登录暂未开放"
                aria-label="微信登录暂未开放"
                sx={footLinkSx}
              >
                微信暂未开放
              </Box>
            )}
          </Box>
        </AnimatedContent>

        <AnimatedContent distance={24} duration={0.7} delay={1580} start={ready}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mt: 2.5 }}>
            <Typography sx={{ color: 'var(--color-text-muted)', fontSize: 9 }}>
              你的信息仅用于社区认证
            </Typography>
            <Box
              component="button"
              type="button"
              onClick={() => navigate('/', { replace: true })}
              sx={{ ...footLinkSx, fontSize: 12, color: WARM, fontWeight: 600 }}
            >
              先逛逛
            </Box>
          </Box>
        </AnimatedContent>
      </Box>

      <BottomSheet open={sheet === 'register'} onClose={closeSheet} title="注册" heightVh={72}>
        <Box component="form" onSubmit={handleRegister} sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Box sx={fieldGroupSx}>
            <TextField value={reg.username} onChange={setRegField('username')} label="用户名（登录用，不可重复）" fullWidth variant="filled" autoComplete="username" sx={sheetFieldSx} />
            <TextField value={reg.nickname} onChange={setRegField('nickname')} label="昵称（对外展示，可稍后修改）" fullWidth variant="filled" autoComplete="nickname" sx={sheetFieldSx} />
            <TextField type="password" value={reg.password} onChange={setRegField('password')} label="密码（至少8位）" fullWidth variant="filled" autoComplete="new-password" sx={sheetFieldSx} />
            <TextField type="password" value={reg.confirm} onChange={setRegField('confirm')} label="确认密码" fullWidth variant="filled" autoComplete="new-password" sx={sheetFieldSx} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                value={reg.building}
                onChange={setRegDigits('building')}
                label="楼栋（数字）"
                placeholder="如 3"
                inputMode="numeric"
                fullWidth
                variant="filled"
                sx={sheetFieldSx}
              />
              <TextField
                value={reg.unit}
                onChange={setRegDigits('unit')}
                label="房号（数字）"
                placeholder="如 501"
                inputMode="numeric"
                fullWidth
                variant="filled"
                sx={sheetFieldSx}
              />
            </Box>
          </Box>

          <Box sx={{ mt: 'auto', pt: 2.5 }}>
            <Button type="submit" disabled={regSubmitting || !reg.username.trim() || !reg.password} sx={sheetPrimaryBtn}>
              {regSubmitting ? '注册中...' : '注册'}
            </Button>
            <Typography sx={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', mt: 1.5, lineHeight: 1.7 }}>
              注册即表示你同意
              <Box
                component="button"
                type="button"
                onClick={() => openProtocol('用户协议')}
                sx={{ ...footLinkSx, color: WARM, fontSize: 11, display: 'inline' }}
              >
                《用户协议》
              </Box>
              和
              <Box
                component="button"
                type="button"
                onClick={() => openProtocol('隐私政策')}
                sx={{ ...footLinkSx, color: WARM, fontSize: 11, display: 'inline' }}
              >
                《隐私政策》
              </Box>
            </Typography>
          </Box>
        </Box>
      </BottomSheet>

      <BottomSheet open={sheet === 'forgot'} onClose={closeSheet} title="忘记密码" heightVh={40}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Typography sx={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            暂不支持自助重置密码。请联系小区管理员核实身份后协助重置。
          </Typography>
          <Box sx={{ mt: 'auto', pt: 2.5 }}>
            <Button onClick={closeSheet} sx={sheetPrimaryBtn}>我知道了</Button>
          </Box>
        </Box>
      </BottomSheet>

      <BottomSheet open={sheet === 'wechat'} onClose={closeSheet} title="微信登录" heightVh={44}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25, pt: 1 }}>
            <Box sx={{
              width: 64, height: 64, borderRadius: '16px', bgcolor: '#07C160',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 28, fontWeight: 700,
            }}>
              微
            </Box>
            <Typography sx={{ fontSize: 13, color: 'var(--color-text-muted)' }}>使用微信账号一键登录</Typography>
          </Box>
          <Box sx={{ mt: 'auto', pt: 2 }}>
            <Button onClick={handleWxLogin} sx={sheetPrimaryBtn}>确认授权</Button>
          </Box>
        </Box>
      </BottomSheet>
    </Box>
  )
}
