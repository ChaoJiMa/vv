import Svg from './svg'

/** 四类业务的功能线标：以援手、纸箱、钥匙、邻居表达含义，不再携带贴纸色面或表情。 */
export default function CategoryIcon({ type = 'help', ...props }) {
  let symbol
  switch (type) {
    case 'idle':
      symbol = (
        <>
          <path d="m4.5 7.5 7.5-4 7.5 4v9L12 20.5l-7.5-4v-9Z" />
          <path d="m4.5 7.5 7.5 4 7.5-4M12 11.5v9M8.2 5.5l7.5 4" />
        </>
      )
      break
    case 'lost':
      symbol = (
        <>
          <circle cx="8.5" cy="9" r="4.5" />
          <circle cx="7.2" cy="7.8" r="0.75" fill="currentColor" stroke="none" />
          <path d="m11.7 12.2 8.3 8.3M15 15.5l2-2M17.5 18l2-2" />
        </>
      )
      break
    case 'group':
      symbol = (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19v-1a5.5 5.5 0 0 1 11 0v1M16 5.3a3 3 0 0 1 0 5.4M17.5 14a4.5 4.5 0 0 1 3 4.3v.7" />
        </>
      )
      break
    case 'help':
    default:
      symbol = (
        <>
          <path d="M4 14h3l2-2h4a1.5 1.5 0 0 1 0 3H10M4 19h3l8.7-.7a2 2 0 0 0 1-.4l3.4-2.6a1.4 1.4 0 0 0-1.6-2.3l-3 2M4 13v7" />
          <path d="M15.5 9.3S12 7.2 12 5a2.1 2.1 0 0 1 3.5-1.5A2.1 2.1 0 0 1 19 5c0 2.2-3.5 4.3-3.5 4.3Z" />
        </>
      )
  }
  return <Svg {...props}>{symbol}</Svg>
}
