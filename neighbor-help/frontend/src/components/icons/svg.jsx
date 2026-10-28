/** 统一线标外壳：currentColor + 圆角描边 */
export default function Svg({ size = 24, children, className = '', style, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}
