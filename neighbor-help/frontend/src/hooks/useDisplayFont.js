import { useEffect, useState } from 'react'

const FALLBACK_FAMILY = 'system-ui, sans-serif'
const DISPLAY_FAMILY = '"KaiXinTi", system-ui, sans-serif'
const FONT_REQUEST = '40px "KaiXinTi"'
// 覆盖登录、注册品牌区及所有产品页标题，避免字体文件已载入但个别标题实际缺字。
const DISPLAY_TEXT = '邻里里 · 远亲不如近邻 欢迎成为新邻居 和身边的邻居，互相搭把手 发现 聊天 消息 首页'
const MAX_WAIT_MS = 1500

/**
 * 展示字体单次门控：等待真实字形加载，成功才启用 KaiXinTi，最迟 1500ms 以系统字体显示。
 * 一次挂载只确定一次结果；超时、失败和无字体 API 后不因迟到响应再次换字，卸载同时撤销定时器。
 */
export default function useDisplayFont() {
  const [state, setState] = useState({ ready: false, fontFamily: FALLBACK_FAMILY })

  useEffect(() => {
    let settled = false
    const finish = (fontFamily) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      setState({ ready: true, fontFamily })
    }
    const timer = setTimeout(() => finish(FALLBACK_FAMILY), MAX_WAIT_MS)
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    let request
    try {
      request = typeof fonts?.load === 'function' ? fonts.load(FONT_REQUEST, DISPLAY_TEXT) : []
    } catch {
      request = []
    }
    Promise.resolve(request).then(
      faces => finish(faces?.length > 0 ? DISPLAY_FAMILY : FALLBACK_FAMILY),
      () => finish(FALLBACK_FAMILY),
    )
    return () => {
      settled = true
      clearTimeout(timer)
    }
  }, [])

  return state
}
