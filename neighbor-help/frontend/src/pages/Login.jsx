import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import GummyCharacter from '../components/icons/GummyCharacter'
import { NavMeIcon } from '../components/icons'
import SplitText from '../components/SplitText'
import BottomSheet from '../components/BottomSheet'
import { useAuth } from '../hooks/useAuth'
import useDisplayFont from '../hooks/useDisplayFont'
import { api } from '../api'
import { toast } from '../toast'
import { getTypeTheme } from '../utils/typeTheme'
import RegistrationGuide from './RegistrationGuide'
import RegistrationForm from './RegistrationForm'
import './Login.css'

const WX_APPID = import.meta.env.VITE_WX_APPID || ''
const REDIRECT_URI = encodeURIComponent(window.location.origin + '/login')
const WARM = 'var(--color-primary)'
const WARM_DARK = 'var(--color-primary-pressed)'

// 只读装饰拼贴复用本项目四类入口；不复制参考产品的人物、文案或登录能力。
const COLLAGE_TYPES = ['help', 'idle', 'lost', 'group', 'help', 'idle', 'lost', 'group', 'help']
const COLLAGE_CAPTIONS = {
  help: '身边小事，互相照应',
  idle: '让好物找到新邻居',
  lost: '帮遗失物品找到主人',
  group: '和邻居一起分享实惠',
}

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

/** 登录保留原字标与账号抽屉；注册使用同路由内可返回的单页引导，原来源随历史一起保留。 */
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

  const [registerBusy, setRegisterBusy] = useState(false)
  const registering = params.get('view') === 'register'

  const openRegistration = () => {
    setSheet(null)
    const next = new URLSearchParams(params)
    next.set('view', 'register')
    navigate({ pathname: '/login', search: `?${next}` }, {
      state: { ...location.state, registrationEntry: true },
    })
  }
  const closeRegistration = () => {
    if (registerBusy) return
    if (location.state?.registrationEntry) navigate(-1)
    else {
      const next = new URLSearchParams(params)
      next.delete('view')
      navigate({ pathname: '/login', search: next.toString() ? `?${next}` : '' }, { replace: true, state: location.state })
    }
  }

  // 只等待装饰文字，入口和表单首帧可用；超时后锁定系统字体，避免迟到再换字。
  const { ready, fontFamily } = useDisplayFont()

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

  const handleWxLogin = () => {
    if (!WX_APPID) return
    window.location.href =
      `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WX_APPID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=snsapi_userinfo&state=login#wechat_redirect`
  }

  if (code) {
    return (
      <Box
        sx={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          minHeight: '100dvh', gap: 1.25,
          bgcolor: 'transparent', color: 'var(--color-text-muted)',
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

  const sheetPrimaryBtn = {
    width: '100%', minHeight: 52, borderRadius: '999px', fontSize: 16, fontWeight: 600,
    bgcolor: WARM, color: 'var(--color-on-primary)', boxShadow: 'none',
    '&:hover': { bgcolor: WARM_DARK, boxShadow: 'none' },
    '&.Mui-disabled': { bgcolor: 'var(--color-disabled-bg)', color: 'var(--color-disabled-text)' },
  }
  if (registering) return (
    <RegistrationGuide onBack={closeRegistration} busy={registerBusy}>
      <RegistrationForm
        onBusyChange={setRegisterBusy}
        onSuccess={(token, registeredUser) => {
          login(token, registeredUser)
          toast.success('注册成功，欢迎加入邻里里')
          // user 更新后由上方统一 effect 返回原操作，避免成功后重复导航。
        }}
        onLogin={() => { closeRegistration(); setSheet('login') }}
      />
    </RegistrationGuide>
  )

  return (
    <Box sx={{
      position: 'relative', minHeight: '100svh', bgcolor: 'transparent',
      overflowX: 'clip', color: 'var(--color-text)', isolation: 'isolate',
      // 字标保留原字体与逐字入场；字体就绪后，减少动态效果时直接显示，表单始终不参与等待。
      '@media (prefers-reduced-motion: reduce)': {
        '& .nh-login-brand > span': {
          animation: 'none !important', opacity: 1, transform: 'none !important', willChange: 'auto',
        },
      },
    }}>
      {/* 文档流透出全局柔光，现有原创卡片仅作局部装饰，不再覆盖 body 背景。 */}
      <Box aria-hidden="true" sx={{
        position: 'absolute', top: 'calc(var(--safe-top) + 12px)', left: 0, right: 0, height: '56svh', maxHeight: 520,
        overflow: 'hidden', pointerEvents: 'none',
        // 两层透明遮罩取交集：四边都回到主题基础底，装饰不进入顶部安全区或形成新的色带。
        maskImage: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.8) 24%, rgba(0,0,0,0.7) 52%, transparent 100%), linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.8) 24%, rgba(0,0,0,0.7) 52%, transparent 100%), linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)',
        maskComposite: 'intersect', WebkitMaskComposite: 'source-in',
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
      }}>
        <Box sx={{
          position: 'absolute', top: -68, left: '50%', width: 590,
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5,
          transform: 'translateX(-50%) rotate(-15deg)', transformOrigin: '50% 35%', opacity: 0.32,
        }}>
          {COLLAGE_TYPES.map((type, index) => {
            const theme = getTypeTheme(type)
            return (
              <Box key={`${type}-${index}`} sx={{
                position: 'relative', height: 114, overflow: 'hidden', p: 1.75,
                borderRadius: '22px', background: theme.cardBg, color: theme.pillFg,
                boxShadow: theme.cardShadow,
              }}>
                <Typography sx={{ fontSize: 14, lineHeight: 1.4, fontWeight: 700 }}>{theme.label}</Typography>
                <Typography sx={{ fontSize: 10, lineHeight: 1.5, mt: 0.5 }}>{COLLAGE_CAPTIONS[type]}</Typography>
                <Box sx={{
                  position: 'absolute', left: 14, bottom: 14, px: 1.5, py: 0.5,
                  borderRadius: '999px', bgcolor: 'var(--color-candy-label-bg)', fontSize: 9,
                }}>邻里互助</Box>
                <GummyCharacter type={type} size={76} style={{ position: 'absolute', right: -2, bottom: -7, '--gummy-scale': 1.12 }} />
              </Box>
            )
          })}
        </Box>
      </Box>

      <Box
        sx={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: 480, minHeight: '100svh', mx: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          // 品牌与入口按参考图分布在中轴，短屏改用自然滚动，不锁定页面或键盘高度。
          px: { xs: 3, sm: 3.5 }, pt: 'calc(35svh + var(--safe-top))',
          pb: 'calc(20px + var(--safe-bottom))',
          '@media (max-height: 700px)': { pt: 'calc(max(152px, 28svh) + var(--safe-top))' },
        }}
      >
        <Box sx={{
          minHeight: '20svh', display: 'flex', flexDirection: 'column', alignItems: 'center',
          '@media (max-height: 700px)': { minHeight: 0 },
        }}>
          {/* 小型三角色图标替代大舞台；只组合项目已有角色，完整字标样式保留在下方。 */}
          <Box aria-hidden="true" sx={{
            position: 'relative', width: 82, height: 82, mb: 1.5,
            overflow: 'hidden', borderRadius: '24px', flexShrink: 0,
            background: 'linear-gradient(145deg, var(--color-category-help-soft), var(--color-category-idle-soft))',
          }}>
            <GummyCharacter type="lost" size={62} style={{ position: 'absolute', left: -11, top: 11, '--gummy-scale': 1.12 }} />
            <GummyCharacter type="help" size={62} style={{ position: 'absolute', right: -7, top: -5, '--gummy-scale': 1.12 }} />
            <GummyCharacter type="idle" size={62} style={{ position: 'absolute', left: 13, bottom: -12, '--gummy-scale': 1.12 }} />
          </Box>
          <Box component="h1" sx={{ m: 0, font: 'inherit', lineHeight: 1 }}>
            <SplitText
              text="邻里里"
              className="nh-login-brand"
              delay={240}
              duration={1.1}
              start={ready}
              sx={{ fontFamily, visibility: ready ? 'visible' : 'hidden', color: 'var(--color-text)', fontSize: 40, fontWeight: 400, letterSpacing: 4, mb: 1 }}
            />
          </Box>
          <SplitText
            text="邻里里 · 远亲不如近邻"
            className="nh-login-brand"
            delay={45}
            duration={0.7}
            startDelay={1100}
            start={ready}
            sx={{ fontFamily, visibility: ready ? 'visible' : 'hidden', color: 'var(--color-text-muted)', fontSize: 14, letterSpacing: 2 }}
          />
        </Box>

        {/* 操作整体下移，说明独立放在文档流页底；入口与账号抽屉的事件保持不变。 */}
        <Box className="nh-login-actions">
          <button className="nh-login-entry" type="button" onClick={() => setSheet('login')}>
            <NavMeIcon size={21} style={{ position: 'absolute', left: 22 }} />
            账号密码登录
          </button>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0.5 }}>
            <Box component="button" type="button" onClick={openRegistration}
              sx={{ ...footLinkSx, minHeight: 40, px: 1.5, fontSize: 12, color: WARM, fontWeight: 600 }}>
              注册账号
            </Box>
            <Box component="span" aria-hidden="true" sx={{ width: '1px', height: 10, bgcolor: 'var(--color-border)' }} />
            <Box component="button" type="button" onClick={() => navigate('/', { replace: true })}
              sx={{ ...footLinkSx, minHeight: 40, px: 1.5, fontSize: 12, color: WARM, fontWeight: 600 }}>
              先逛逛
            </Box>
          </Box>
        </Box>
        <p className="nh-login-note">账号用于登录，公开资料可在个人页设置</p>
      </Box>

      <BottomSheet className="nh-login-drawer" open={sheet === 'login'} onClose={closeSheet} title="账号登录">
        <Box
          component="form"
          className="nh-login-sheet"
          onSubmit={handleLogin}
          sx={{ width: '100%' }}
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
            <button
              type="submit"
              className="nh-login-submit"
              disabled={submitting || !username.trim() || !password}
            >
              {submitting ? (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} sx={{ color: 'currentColor' }} />
                  登录中
                </Box>
              ) : '登录'}
            </button>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 1.25, mt: 1, color: 'var(--color-text-muted)', fontSize: 12 }}>
          <Box component="button" type="button" onClick={() => setSheet('forgot')} sx={{ ...footLinkSx, minHeight: 40, px: 0.5 }}>忘记密码</Box>
          {WX_APPID ? <>
            <Box component="span" sx={{ opacity: 0.45 }} aria-hidden>·</Box>
            <Box component="button" type="button" onClick={() => setSheet('wechat')} sx={{ ...footLinkSx, minHeight: 40, px: 0.5 }}>微信登录</Box>
          </> : null}
        </Box>
      </BottomSheet>

      <BottomSheet className="nh-login-drawer" open={sheet === 'forgot'} onClose={closeSheet} title="忘记密码" heightVh={40}>
        <Box className="nh-login-sheet" sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Typography sx={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            暂不支持自助重置密码。请联系小区管理员核实身份后协助重置。
          </Typography>
          <Box sx={{ mt: 'auto', pt: 2.5 }}>
            <Button onClick={closeSheet} sx={sheetPrimaryBtn}>我知道了</Button>
          </Box>
        </Box>
      </BottomSheet>

      <BottomSheet className="nh-login-drawer" open={sheet === 'wechat'} onClose={closeSheet} title="微信登录" heightVh={44}>
        <Box className="nh-login-sheet" sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
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
