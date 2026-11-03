import { BellIcon, NavMessageIcon, SearchIcon } from '../icons'
import Svg from '../icons/svg'

/** 空状态只提供低彩度的辅助符号；状态含义由旁边的标题与说明传达。 */
function EmptySymbol({ Icon, size = 64 }) {
  return <Icon size={size} style={{ color: 'var(--color-text-muted)', margin: '0 auto' }} />
}

export function EmptyPosts({ size }) {
  return <EmptySymbol Icon={PostDocumentIcon} size={size} />
}

/** 帖子是文字内容入口，用文档线标表示，避免与“暂无图片”混淆。 */
function PostDocumentIcon(props) {
  return (
    <Svg {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </Svg>
  )
}

export function EmptySearch({ size }) {
  return <EmptySymbol Icon={SearchIcon} size={size} />
}

export function EmptyMessages({ size }) {
  return <EmptySymbol Icon={NavMessageIcon} size={size} />
}

export function EmptyNotices({ size }) {
  return <EmptySymbol Icon={BellIcon} size={size} />
}

/** 缺失页面使用文件轮廓与短横线，不在 SVG 内重复渲染状态文案。 */
function MissingPageIcon(props) {
  return (
    <Svg {...props}>
      <g stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10L13 3Z" />
        <path d="M13 3v7h7M9 15h6" />
      </g>
    </Svg>
  )
}

export function EmptyLost({ size }) {
  return <EmptySymbol Icon={MissingPageIcon} size={size} />
}
