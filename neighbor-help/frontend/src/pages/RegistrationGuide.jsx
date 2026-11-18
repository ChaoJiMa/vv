import { useLayoutEffect } from 'react'
import GummyCharacter from '../components/icons/GummyCharacter'
import { BackIcon } from '../components/icons'
import useDisplayFont from '../hooks/useDisplayFont'
import { acquireRegistrationChrome } from '../theme/themeChrome'
import './RegistrationGuide.css'

/**
 * 单页注册布局：顶部展示原创角色与欢迎信息，下方直接容纳父级提供的完整注册表单。
 * children 负责字段、可选邀请码、校验与提交；本组件不创建 form、不访问 API 或存储密码。
 * onBack 返回登录入口，busy 时仅锁定返回按钮；表单自身的忙碌状态由父级控制。
 */
export default function RegistrationGuide({ children, onBack, busy = false }) {
  const { ready, fontFamily } = useDisplayFont()
  // 在首个注册画面绘制前申请；主题切换由统一同步器重算，离开立即释放，避免残留暖黄状态栏。
  useLayoutEffect(() => acquireRegistrationChrome(), [])
  return (
    <main className="nh-registration-guide" aria-busy={busy || undefined}>
      <header className={`nh-registration-guide-hero${ready ? '' : ' nh-registration-font-pending'}`} style={{ '--font-display': fontFamily }}>
        <div className="nh-registration-guide-topbar">
          <button
            type="button"
            className="nh-registration-guide-back"
            aria-label="返回登录"
            onClick={onBack}
            disabled={busy}
          >
            <BackIcon size={22} />
          </button>
          <span className="nh-registration-guide-brand">邻里里</span>
          <span aria-hidden="true" />
        </div>
        <h1>欢迎成为新邻居</h1>
        <p className="nh-registration-guide-subtitle">和身边的邻居，互相搭把手</p>

        {/* 角色位于独立画布内，不遮盖文字、返回按钮或父级表单，也不进入读屏顺序。 */}
        <div className="nh-registration-guide-art" aria-hidden="true">
          <div className="nh-registration-guide-character nh-registration-guide-character-left">
            <GummyCharacter type="idle" size={158} style={{ '--gummy-scale': 1.06 }} />
          </div>
          <div className="nh-registration-guide-character nh-registration-guide-character-right">
            <GummyCharacter type="lost" size={166} style={{ '--gummy-scale': 1.06 }} />
          </div>
        </div>
      </header>

      <section className="nh-registration-guide-panel" aria-label="注册信息">
        {children}
      </section>
    </main>
  )
}
