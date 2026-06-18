import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CloseIcon from '@mui/icons-material/Close'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import SplitText from '../components/SplitText'
import AnimatedContent from '../components/AnimatedContent'
import { useAuth } from '../hooks/useAuth'
import { api } from '../api'
import { toast } from '../toast'

const WX_APPID = import.meta.env.VITE_WX_APPID || ''
const REDIRECT_URI = encodeURIComponent(window.location.origin + '/login')
// 暖橙主操作色:与徽标/光晕同调,统一整页暖色情绪(替代原科技蓝)
const WARM = '#EC6E33'
const WARM_DARK = '#D85F26'
// 弹窗/选择块的暖调灰底(原冷灰 #F2F2F7,微微往暖白偏,呼应整页暖橙)
const WARM_FILL = '#F4EEE7'
const WARM_FILL_HOVER = '#EDE4DA'
// 小区结构:期数 -> 楼栋 -> 单元 三层级联(占位数据,等接入真实小区结构后替换)
const COMMUNITY = {
  '一期': {
    '1号楼': ['1单元', '2单元', '3单元'],
    '2号楼': ['1单元', '2单元'],
    '3号楼': ['1单元', '2单元', '3单元', '4单元'],
  },
  '二期': {
    '4号楼': ['1单元', '2单元'],
    '5号楼': ['1单元', '2单元', '3单元'],
    '6号楼': ['1单元'],
  },
  '三期': {
    '7号楼': ['1单元', '2单元'],
    '8号楼': ['1单元', '2单元', '3单元'],
  },
}
const PHASES = Object.keys(COMMUNITY)

// 位置选择弹窗内的 chip 样式:选中暖橙、未选暖灰
const regChipSx = (active) => ({
  height: 36, borderRadius: '10px', fontSize: 14, px: 0.5,
  bgcolor: active ? WARM : WARM_FILL,
  color: active ? '#fff' : '#1C1C1E',
  fontWeight: active ? 600 : 400,
  '&:hover': { bgcolor: active ? WARM_DARK : WARM_FILL_HOVER },
})

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useAuth()
  const code = params.get('code')

  // 登录态
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 底部弹窗:null | 'register' | 'forgot' | 'wechat'
  const [sheet, setSheet] = useState(null)
  const closeSheet = () => setSheet(null)

  // 注册态
  const [reg, setReg] = useState({ username: '', password: '', confirm: '', phase: '', building: '', unit: '' })
  const [regSubmitting, setRegSubmitting] = useState(false)
  const setRegField = (k) => (e) => setReg(r => ({ ...r, [k]: e.target.value }))
  // 位置级联选择弹窗开关(期数/楼栋/单元)
  const [regionOpen, setRegionOpen] = useState(false)
  const regionText = [reg.phase, reg.building, reg.unit].filter(Boolean).join(' / ')

  // 重置密码态
  const [resetAccount, setResetAccount] = useState('')

  // 锁定首帧视口高度:微信 X5 进页面时工具栏/地址栏高度在首帧会变一次,
  // 用 100dvh + 贴底布局会随之被整体上顶 ——「弹跳」的真正来源(与动画无关)。
  // 惰性初始化在首次渲染就读 innerHeight(纯 px,不经 dvh),之后不随工具栏变化,布局不重排。
  const [lockedH] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 0
  )
  // 有锁定值就用纯 px,否则回退 100dvh(SSR/极端环境)
  const pageMinH = lockedH ? `${lockedH}px` : '100dvh'

  // 入场门控 + 字体就绪:必须等标题字体「真正加载完」后,元素仍处于 opacity:0(不可见)时
  // 让浏览器完成字体换帧的 reflow,再揭示入场。否则会出现可见的位移弹跳。
  //
  // 病根:贴底布局(justify-end)下,标题字体从回退 system-ui 换成更紧凑的 KaiXinTi 后标题变矮 →
  // 总内容变矮 → 顶部空白变大 → 最顶的 icon 被推「向下」。
  // 之前用 document.fonts.ready 会「假就绪」(CSS 尚未引用该字体时立即 resolve),导致元素先以
  // system-ui 可见、字体后到才 reflow → 可见弹跳。改用 fonts.load(指定字号)等具体字体真就绪。
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    let raf1, raf2, timer
    const reveal = () => {
      if (cancelled) return
      // 字体已就绪后再过两帧:确保浏览器先完成(不可见的)reflow,再揭示,彻底无跳变
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => { if (!cancelled) setReady(true) })
      })
    }
    if (document.fonts && document.fonts.load) {
      // 显式按标题/小标题用到的字号加载 KaiXinTi,Promise resolve 即该字体真正可用
      Promise.all([
        document.fonts.load('40px "KaiXinTi"'),
        document.fonts.load('14px "KaiXinTi"'),
      ]).then(reveal, reveal)
      // 兜底:字体异常/加载超时,1s 后也放行,避免页面一直不显示
      timer = setTimeout(reveal, 1000)
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

  // 微信回调:带 code 时自动换取登录态(仅执行一次,避免 StrictMode/重渲染重复请求)
  const exchanged = useRef(false)
  useEffect(() => {
    if (code && !exchanged.current) {
      exchanged.current = true
      api.loginWithCode(code).then(({ token, user }) => {
        login(token, user)
        navigate('/')
      }).catch(() => navigate('/login'))
    }
  }, [code, login, navigate])

  // 登录页为暖白主题:把 body 背景临时设为同款暖白,避免 iOS 橡皮筋过度滚动时露出黑底;
  // 卸载时恢复,不影响 Home 等浅色页面。
  // 注:必须设 backgroundColor(纯色),橡皮筋区只填充纯色,用 background 简写会把色重置为透明 → 露黑。
  useEffect(() => {
    const prevBgColor = document.body.style.backgroundColor
    const prevOverscroll = document.body.style.overscrollBehavior
    document.body.style.backgroundColor = '#FBEFE3'
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
      navigate('/')
    } catch {
      // 错误已由 api 层 toast
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegister = async (e) => {
    e?.preventDefault()
    if (regSubmitting) return
    // 前置校验,与后端规则一致:用户名 4-20 位字母/数字、密码至少 8 位、两次一致
    if (!/^[a-zA-Z0-9]{4,20}$/.test(reg.username.trim())) {
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
        username: reg.username.trim(),
        password: reg.password,
        // 期数 + 楼栋合并存入 building(后端无单独 phase 列),如「一期1号楼」
        building: [reg.phase, reg.building].filter(Boolean).join(''),
        unit: reg.unit.trim(),
      })
      login(token, user)
      navigate('/')
    } catch {
      // 错误已 toast
    } finally {
      setRegSubmitting(false)
    }
  }

  // 重置密码:后端暂无自助重置接口,这里只做引导(不假装已发送)
  const handleReset = (e) => {
    e?.preventDefault()
    toast.info('暂未开放自助重置,请联系小区管理员核实身份后重置')
  }

  const handleWxLogin = () => {
    if (!WX_APPID) return
    window.location.href =
      `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WX_APPID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=snsapi_userinfo&state=login#wechat_redirect`
  }

  if (code) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh', gap: 1, bgcolor: '#000', color: 'grey.500' }}>
        <CircularProgress size={20} /> 登录中...
      </Box>
    )
  }

  // 登录卡片内输入框:浮动标签 + 毛玻璃浅底上的深色文字
  // 注:字号 16px 是为防止 iOS Safari 聚焦输入框时强制放大页面(<16px 会触发缩放)
  // 文字深石板灰保证可读;聚焦标签/下划线用暖橙,与整页暖色主题统一
  const fieldSx = {
    '& .MuiInput-root': { fontSize: 16, color: '#1f2630' },
    '& label': { fontSize: 15, color: 'rgba(31,38,48,0.55)' },
    '& label.Mui-focused': { color: WARM },
    '& .MuiInput-root:before': { borderBottomColor: 'rgba(31,38,48,0.28)' },
    '& .MuiInput-root:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(31,38,48,0.5)' },
    '& .MuiInput-root::after': { borderBottomColor: WARM },
  }

  // 弹窗内输入块容器:多个 filled 块垂直堆叠,块间小间距
  const fieldGroupSx = { display: 'flex', flexDirection: 'column', gap: 1.25 }
  // 弹窗内 filled 输入:灰底圆角块 + 浮动标签(嵌入块内顶部,紧凑),无下划线
  // 字号 16px 防 iOS 聚焦放大;label 聚焦科技蓝
  // 固定 56px 高;收起态 label 用 translate 垂直居中,聚焦/有值时回到默认上移
  const sheetFieldSx = {
    '& .MuiFilledInput-root': {
      bgcolor: WARM_FILL, borderRadius: '10px', fontSize: 16, color: '#1C1C1E', overflow: 'hidden',
      '&:hover': { bgcolor: WARM_FILL_HOVER },
      '&.Mui-focused': { bgcolor: WARM_FILL_HOVER },
      '&::before, &::after': { display: 'none' }, // 去掉 filled 默认下划线
    },
    '& .MuiFilledInput-input': { pt: '22px', pb: '7px', height: 27 },
    '& label': { fontSize: 14, color: '#9CA3AF', transform: 'translate(12px, 20px) scale(1)' },
    '& label.MuiInputLabel-shrink': { transform: 'translate(12px, 7px) scale(0.82)' },
    '& label.Mui-focused': { color: WARM },
  }
  // 弹窗主按钮:深黑全宽(参考稿 #1C1C1E / 50px / 12px / 16px-600)
  const sheetDarkBtn = {
    width: '100%', height: 50, borderRadius: '12px', fontSize: 16, fontWeight: 600,
    bgcolor: '#1C1C1E', color: '#fff', boxShadow: 'none',
    '&:hover': { bgcolor: '#000', boxShadow: 'none' },
    '&.Mui-disabled': { bgcolor: 'grey.300', color: '#fff' },
  }

  return (
    <Box sx={{ position: 'relative', minHeight: pageMinH, bgcolor: '#FBEFE3', overflow: 'hidden' }}>
      {/* 暖橙淡彩呼吸背景:极淡暖白底 + 多团独立漂移脉动的暖色光斑(错峰不同周期,做出有机呼吸感) */}
      <Box
        sx={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(180deg, #FFF6EC 0%, #FBEFE3 100%)',
          overflow: 'hidden',
          // 每团光斑各自的脉动关键帧:位移 + 缩放 + 明暗,错峰;不透明度在 30-55%,呼吸明显
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
          '@keyframes blobD': {
            '0%, 100%': { transform: 'translate(0, 0) scale(1.12)', opacity: 0.55 },
            '50%': { transform: 'translate(7%, -6%) scale(0.9)', opacity: 0.32 },
          },
          '& > span': { position: 'absolute', borderRadius: '50%', filter: 'blur(72px)' },
        }}
      >
        {/* 暖橙 —— 左上角大光晕(主) */}
        <Box component="span" sx={{ width: '85%', height: '70%', top: '-30%', left: '-30%', bgcolor: '#FFB067', animation: 'blobA 6.3s ease-in-out infinite', animationDelay: '-1.2s' }} />
        {/* 淡桃 —— 右上淡填充 */}
        <Box component="span" sx={{ width: '60%', height: '52%', top: '-18%', right: '-26%', bgcolor: '#FFCB8E', animation: 'blobB 7.7s ease-in-out infinite', animationDelay: '-3.5s' }} />
        {/* 暖珊瑚 —— 中部淡填充 */}
        <Box component="span" sx={{ width: '58%', height: '46%', top: '34%', left: '8%', bgcolor: '#FF9476', animation: 'blobC 5.4s ease-in-out infinite', animationDelay: '-4.6s' }} />
        {/* 淡紫 —— 右下角大光晕(主) */}
        <Box component="span" sx={{ width: '82%', height: '66%', bottom: '-30%', right: '-28%', bgcolor: '#C9A7F0', animation: 'blobD 8.5s ease-in-out infinite', animationDelay: '-2.1s' }} />
      </Box>
      {/* 上层极轻暖白雾:统一调性、压一点光晕,不再用强模糊(光晕已大模糊+低透明,无需再均化) */}
      <Box
        sx={{
          position: 'absolute', inset: 0, zIndex: 0,
          bgcolor: 'rgba(253,244,236,0.08)',
        }}
      />

      {/* 内容层:整体下沉,贴近底部 */}
      <Box
        sx={{
          position: 'relative', zIndex: 1,
          minHeight: pageMinH, maxWidth: 480, mx: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'flex-end', px: 3,
          pb: 'calc(20px + env(safe-area-inset-bottom))',
        }}
      >
        {/* 品牌区:圆形徽标 + 标题 + 小标题 */}
        <AnimatedContent distance={24} duration={0.7} delay={0} start={ready}>
          <Box
            sx={{
              width: 64, height: 64, borderRadius: '20px', mb: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(145deg, #FFB067 0%, #FF8A6B 100%)',
              boxShadow: '0 8px 24px rgba(255,138,107,0.35)',
            }}
          >
            <HomeRoundedIcon sx={{ fontSize: 34, color: '#fff' }} />
          </Box>
        </AnimatedContent>
        {/* 标题用 Split Text 逐字入场 */}
        <SplitText
          text="邻里里"
          delay={240}
          duration={1.1}
          start={ready}
          sx={{ fontFamily: '"KaiXinTi", system-ui, sans-serif', color: '#1f2630', fontSize: 40, fontWeight: 400, letterSpacing: 4, mb: 1 }}
        />
        <SplitText
          text="邻里里 · 远亲不如近邻"
          delay={45}
          duration={0.7}
          startDelay={1300}
          start={ready}
          sx={{ fontFamily: '"KaiXinTi", system-ui, sans-serif', color: 'rgba(31,38,48,0.6)', fontSize: 14, letterSpacing: 2, mb: 4 }}
        />

        {/* 表单卡片:精致白卡——高不透明白 + 细描边 + 柔和投影,在暖白光晕上清晰浮起 */}
        <AnimatedContent distance={28} duration={0.7} delay={1500} start={ready} sx={{ width: '100%' }}>
          <Box
            component="form"
            onSubmit={handleLogin}
            sx={{
              width: '100%',
              bgcolor: 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.9)',
              px: 2.5, py: 2,
              boxShadow: '0 8px 32px rgba(180,120,60,0.12), 0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
          <TextField
            value={username}
            onChange={e => setUsername(e.target.value)}
            label="用户名"
            variant="standard"
            fullWidth
            autoComplete="username"
            sx={{ ...fieldSx, mb: 1 }}
          />
          <TextField
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            label="密码"
            variant="standard"
            fullWidth
            autoComplete="current-password"
            sx={fieldSx}
            slotProps={{
              input: {
                endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    type="submit"
                    edge="end"
                    disabled={submitting || !username.trim() || !password}
                    sx={{
                      width: 32, height: 32,
                      // 抬离下划线:standard 变体下划线在底部,圆按钮垂直居中会压到线上
                      mb: '6px',
                      // 暖橙实心主操作按钮,呼应徽标渐变,在浅毛玻璃卡上是清晰的 CTA
                      bgcolor: WARM,
                      color: '#fff',
                      boxShadow: '0 4px 12px rgba(236,110,51,0.32)',
                      '&:hover': { bgcolor: WARM_DARK, boxShadow: '0 4px 12px rgba(236,110,51,0.32)' },
                      // 禁用态(初始空表单):暖色淡底,提示但不喧宾夺主
                      '&.Mui-disabled': { bgcolor: 'rgba(236,110,51,0.16)', color: 'rgba(255,255,255,0.85)', boxShadow: 'none' },
                    }}
                  >
                    {submitting ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <ArrowForwardIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </InputAdornment>
              ),
              },
            }}
          />
          </Box>
        </AnimatedContent>

        {/* 底部链接:一行居中,触发底部弹窗 */}
        <AnimatedContent distance={24} duration={0.7} delay={1680} start={ready}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 3, color: 'rgba(31,38,48,0.65)', fontSize: 12 }}>
            <Box component="span" onClick={() => setSheet('register')} sx={{ cursor: 'pointer', '&:active': { opacity: 0.6 } }}>注册</Box>
            <Box component="span" sx={{ color: 'rgba(31,38,48,0.3)' }}>·</Box>
            <Box component="span" onClick={() => setSheet('forgot')} sx={{ cursor: 'pointer', '&:active': { opacity: 0.6 } }}>忘记密码</Box>
            <Box component="span" sx={{ color: 'rgba(31,38,48,0.3)' }}>·</Box>
            <Box component="span" onClick={() => setSheet('wechat')} sx={{ cursor: 'pointer', '&:active': { opacity: 0.6 } }}>微信登录</Box>
          </Box>
        </AnimatedContent>

        <AnimatedContent distance={24} duration={0.7} delay={1820} start={ready}>
          <Typography sx={{ color: 'rgba(31,38,48,0.45)', fontSize: 9, mt: 2.5 }}>
            你的信息仅用于社区认证
          </Typography>
        </AnimatedContent>
      </Box>

      {/* ===== 注册弹窗 ===== */}
      <BottomSheet open={sheet === 'register'} onClose={closeSheet} title="注册" heightVh={66}>
        <Box component="form" onSubmit={handleRegister} sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* 账号信息 + 楼栋单元:统一 filled 块,小间距堆叠 */}
          <Box sx={fieldGroupSx}>
            <TextField value={reg.username} onChange={setRegField('username')} label="用户名（4-20位字母或数字）" fullWidth variant="filled" autoComplete="username" sx={sheetFieldSx} />
            <TextField type="password" value={reg.password} onChange={setRegField('password')} label="密码（至少8位）" fullWidth variant="filled" autoComplete="new-password" sx={sheetFieldSx} />
            <TextField type="password" value={reg.confirm} onChange={setRegField('confirm')} label="确认密码" fullWidth variant="filled" autoComplete="new-password" sx={sheetFieldSx} />
            {/* 位置:点击打开期数/楼栋/单元级联选择弹窗 */}
            <Box
              onClick={() => setRegionOpen(true)}
              sx={{
                bgcolor: WARM_FILL, borderRadius: '10px', height: 56,
                px: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', '&:active': { bgcolor: WARM_FILL_HOVER },
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Typography sx={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.2 }}>所在位置</Typography>
                <Typography sx={{ fontSize: 16, color: regionText ? '#1C1C1E' : '#9CA3AF', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {regionText || '选择期数 / 楼栋 / 单元'}
                </Typography>
              </Box>
              <ArrowForwardIcon sx={{ fontSize: 18, color: '#C7C7CC', flexShrink: 0, ml: 1 }} />
            </Box>
          </Box>

          {/* 底部:注册按钮 + 协议 */}
          <Box sx={{ mt: 'auto', pt: 2.5 }}>
            <Button type="submit" disabled={regSubmitting || !reg.username.trim() || !reg.password} sx={sheetDarkBtn}>
              {regSubmitting ? '注册中...' : '注册'}
            </Button>
            <Typography sx={{ fontSize: 11, color: '#C7C7CC', textAlign: 'center', mt: 1.5, lineHeight: 1.7 }}>
              注册即表示你同意
              <Link href="#" underline="none" sx={{ color: WARM }} onClick={(e) => e.preventDefault()}>《用户协议》</Link>
              和
              <Link href="#" underline="none" sx={{ color: WARM }} onClick={(e) => e.preventDefault()}>《隐私政策》</Link>
            </Typography>
          </Box>
        </Box>
      </BottomSheet>

      {/* ===== 重置密码弹窗(44%) ===== */}
      <BottomSheet open={sheet === 'forgot'} onClose={closeSheet} title="重置密码" heightVh={44}>
        <Box component="form" onSubmit={handleReset} sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Typography sx={{ fontSize: 13, color: '#8E8E93', mb: 2.5, lineHeight: 1.5 }}>
            输入你的用户名,我们将协助你重置密码
          </Typography>
          <TextField value={resetAccount} onChange={e => setResetAccount(e.target.value)} label="用户名" fullWidth variant="filled" sx={sheetFieldSx} />
          <Box sx={{ mt: 'auto', pt: 2.5 }}>
            <Button type="submit" disabled={!resetAccount.trim()} sx={sheetDarkBtn}>发送重置链接</Button>
          </Box>
        </Box>
      </BottomSheet>

      {/* ===== 微信登录弹窗 ===== */}
      <BottomSheet open={sheet === 'wechat'} onClose={closeSheet} title="微信登录" heightVh={44}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25, pt: 1 }}>
            <Box sx={{ width: 64, height: 64, borderRadius: '16px', bgcolor: '#07C160', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>
              💬
            </Box>
            <Typography sx={{ fontSize: 13, color: '#8E8E93' }}>使用微信账号一键登录</Typography>
          </Box>
          <Box sx={{ mt: 'auto', pt: 2 }}>
            <Button onClick={WX_APPID ? handleWxLogin : closeSheet} sx={sheetDarkBtn}>
              {WX_APPID ? '确认授权' : '微信登录暂未开放'}
            </Button>
          </Box>
        </Box>
      </BottomSheet>

      {/* ===== 位置级联选择弹窗(期数/楼栋/单元) ===== */}
      <BottomSheet open={regionOpen} onClose={() => setRegionOpen(false)} title="选择所在位置" heightVh={60}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 期数 */}
          <Box>
            <Typography sx={{ fontSize: 13, color: '#8E8E93', mb: 1 }}>期数</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {PHASES.map(p => (
                <Chip
                  key={p}
                  label={p}
                  onClick={() => setReg(r => ({ ...r, phase: p, building: '', unit: '' }))}
                  sx={regChipSx(reg.phase === p)}
                />
              ))}
            </Box>
          </Box>

          {/* 楼栋(选期数后出现) */}
          {reg.phase && (
            <Box>
              <Typography sx={{ fontSize: 13, color: '#8E8E93', mb: 1 }}>楼栋</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Object.keys(COMMUNITY[reg.phase] || {}).map(b => (
                  <Chip
                    key={b}
                    label={b}
                    onClick={() => setReg(r => ({ ...r, building: b, unit: '' }))}
                    sx={regChipSx(reg.building === b)}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* 单元(选楼栋后出现,选中即关闭) */}
          {reg.phase && reg.building && (
            <Box>
              <Typography sx={{ fontSize: 13, color: '#8E8E93', mb: 1 }}>单元</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {(COMMUNITY[reg.phase]?.[reg.building] || []).map(u => (
                  <Chip
                    key={u}
                    label={u}
                    onClick={() => { setReg(r => ({ ...r, unit: u })); setRegionOpen(false) }}
                    sx={regChipSx(reg.unit === u)}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </BottomSheet>
    </Box>
  )
}

// 居中底部抽屉:从底部滑入,圆角顶 + 拖拽手柄 + 标题 + 圆形关闭按钮(对齐参考稿)
// 手柄区支持指针拖拽:按住下滑跟手移动,松手超过阈值关闭,否则回弹。
function BottomSheet({ open, onClose, title, heightVh = 50, children }) {
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false) // 仅用于渲染期决定是否禁用过渡
  const dragging = useRef(false)
  const startY = useRef(0)
  const curDy = useRef(0)

  const onPointerDown = (e) => {
    dragging.current = true
    setIsDragging(true)
    startY.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragging.current) return
    const dy = Math.max(0, e.clientY - startY.current) // 只允许向下
    curDy.current = dy
    setDragY(dy)
  }
  const endDrag = () => {
    if (!dragging.current) return
    dragging.current = false
    setIsDragging(false)
    // 下滑超过 80px 视为关闭意图,否则回弹
    if (curDy.current > 80) onClose()
    else { setDragY(0); curDy.current = 0 }
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      // 进入用 ease-out-expo:起步快、长程平滑减速到停,无过冲回弹(最顺滑、不突兀);退出干脆
      transitionDuration={{ enter: 450, exit: 240 }}
      slotProps={{
        transition: {
          easing: {
            enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
            exit: 'cubic-bezier(0.4, 0, 1, 1)',
          },
        },
        backdrop: {
          // 遮罩降低黑度 + 轻微模糊,避免瞬间压黑的生硬感
          sx: {
            bgcolor: 'rgba(0,0,0,0.32)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          },
        },
        paper: {
          sx: {
            width: '100%', maxWidth: 480, mx: 'auto',
            height: `${heightVh}dvh`,
            borderRadius: '20px 20px 0 0',
            overflow: 'hidden',
            px: 3, pt: 0,
            // 底部内边距并入 iOS 安全区,避免按钮被 Home 指示条遮挡
            pb: 'calc(24px + env(safe-area-inset-bottom))',
            display: 'flex', flexDirection: 'column',
            bgcolor: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            borderTop: '1px solid rgba(255,255,255,0.5)',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
            backgroundImage: 'none',
            transform: dragY ? `translateY(${dragY}px)` : 'none',
            transition: isDragging ? 'none' : 'transform 0.25s ease',
          },
        },
      }}
    >
      {/* 拖拽手柄(可按住下滑关闭) */}
      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 1, flexShrink: 0, cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
      >
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'rgba(31,38,48,0.3)' }} />
      </Box>
      {/* 标题行 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 0.5, pb: 2.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 600, color: '#1C1C1E', letterSpacing: '-0.01em' }}>{title}</Typography>
        <IconButton onClick={onClose} sx={{ width: 28, height: 28, bgcolor: WARM_FILL, color: '#8E8E93', '&:hover': { bgcolor: WARM_FILL_HOVER } }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      {/* 内容(不滚动,一页展示) */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Drawer>
  )
}
