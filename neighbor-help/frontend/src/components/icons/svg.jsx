/** 24 网格线标外壳：统一 1.8 描边，颜色跟随调用方，装饰图形不单独进入焦点顺序。 */
export default function Svg({ size = 24, children, className = '', style, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}
