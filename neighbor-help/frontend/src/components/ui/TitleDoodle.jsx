import { useId } from 'react'
import './TitleDoodle.css'

/** 品牌与页面标题共用的卷线装饰：独立渐变 ID，随主题换色，不参与读屏、焦点或点击。 */
export default function TitleDoodle({ className = '' }) {
  const gradientId = `nh-title-doodle-${useId()}`
  return (
    <svg
      className={`nh-title-doodle ${className}`.trim()}
      width="48"
      height="40"
      viewBox="0 0 54 44"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="36" x2="47" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--title-doodle-pink)" />
          <stop offset="100%" stopColor="var(--title-doodle-orange)" />
        </linearGradient>
      </defs>
      <path
        d="M3 35c14 2 32-6 33-17 1-8-14-9-13 0 1 7 16 6 23 1"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m45 3 1.6 4.4 4.4 1.6-4.4 1.6L45 15l-1.6-4.4L39 9l4.4-1.6Z" fill="var(--title-doodle-star)" />
      <path d="m51 17 .8 2.2 2.2.8-2.2.8L51 23l-.8-2.2L48 20l2.2-.8Z" fill="var(--title-doodle-star)" />
    </svg>
  )
}
