import TitleDoodle from './TitleDoodle'
import useDisplayFont from '../../hooks/useDisplayFont'
import './PageTitle.css'

/** 产品标题沿用首页品牌字形；只门控文字，字体等待时卷线与同行操作仍立即可用。 */
export default function PageTitle({ children, className = '' }) {
  const { ready, fontFamily } = useDisplayFont()
  return (
    <h1 className={`nh-page-title ${className}`.trim()}>
      <span className="nh-page-title-text" style={{ fontFamily, visibility: ready ? 'visible' : 'hidden' }}>{children}</span>
      <TitleDoodle className="nh-page-title-doodle" />
    </h1>
  )
}
