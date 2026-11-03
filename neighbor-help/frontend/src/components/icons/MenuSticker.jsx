import GummyCharacter from './GummyCharacter'

/**
 * 旧贴纸入口的兼容外壳：保留 type/size/className/style 及 SVG 属性，
 * 四类业务使用原创简洁软团角色，未知分类由角色组件回退线标；底色和选中态仍由调用组件负责。
 */
export default function MenuSticker({ type = 'help', size = 48, className = '', style, ...rest }) {
  return <GummyCharacter type={type} size={size} className={className} style={style} {...rest} />
}
