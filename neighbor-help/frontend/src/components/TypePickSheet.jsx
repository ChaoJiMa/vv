import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { Sheet } from './ui'
import { MenuSticker } from './icons'
import { getTypeTheme } from '../utils/typeTheme'

/** 发布分类选择：保留原两列、占位与文字位置；大角色绘制在右上留白，糖果叠层不参与布局。 */
export default function TypePickSheet({ open, onClose, value, onPick, title = '选择分类' }) {
  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingBottom: 8 }}>
        {menus.map((t) => {
          const active = value === t.value
          const theme = getTypeTheme(t.value, t)
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              className="nh-type-pick"
              onClick={() => onPick?.(t.value)}
              style={{
                position: 'relative', isolation: 'isolate', overflow: 'hidden',
                textAlign: 'left', padding: 14, borderRadius: 20, cursor: 'pointer',
                border: `1.5px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
                background: theme.cardBg,
                boxShadow: theme.cardShadow,
                '--candy-card-bg': theme.cardBg,
                color: 'var(--color-text)', minHeight: 104,
              }}
            >
              <span aria-hidden style={{ display: 'block', width: 28, height: 28 }}>
                <MenuSticker type={t.value} size={28} style={{ color: theme.pillFg }} />
              </span>
              <div style={{ position: 'relative', zIndex: 1, fontSize: 14, fontWeight: 600, marginTop: 10 }}>{t.label}</div>
              <div style={{ position: 'relative', zIndex: 1, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-muted)', marginTop: 4 }}>{t.desc}</div>
            </button>
          )
        })}
      </div>
      <style>{`
        /* 卡面下移的绘制层露出顶部薄叠片；全部处于原按钮内部，不挤占弹层空间。 */
        .nh-type-pick::before {
          content: '';
          position: absolute;
          inset: 7px -1px -1px;
          border-radius: inherit;
          background: var(--candy-card-bg);
          box-shadow: inset 0 1px 0 var(--color-material-highlight);
          z-index: -1;
          pointer-events: none;
        }
      `}</style>
    </Sheet>
  )
}
