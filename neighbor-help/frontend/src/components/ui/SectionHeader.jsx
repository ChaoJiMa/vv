/** 区块标题行：左侧标题，右侧可选操作 */
export default function SectionHeader({ title, action, style }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px 8px',
        ...style,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
      {action || null}
    </div>
  )
}
