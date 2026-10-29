import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { Sheet } from './ui'
import { MenuSticker } from './icons'

const ENTRY_COLORS = ['mint', 'sky', 'cream', 'primary']

/** 发布分类选择底部弹层 */
export default function TypePickSheet({ open, onClose, value, onPick, title = '选择分类' }) {
  const { data: menus = [] } = useQuery({
    queryKey: ['menus'],
    queryFn: () => api.getMenus(),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingBottom: 8 }}>
        {menus.map((t, i) => {
          const active = value === t.value
          const tint = ENTRY_COLORS[i % ENTRY_COLORS.length]
          const bg = tint === 'primary' ? 'var(--color-bg-accent)' : `var(--color-accent-${tint})`
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onPick?.(t.value)}
              style={{
                textAlign: 'left', padding: 14, borderRadius: 16, cursor: 'pointer',
                border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)',
                background: active ? 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))' : bg,
                color: 'var(--color-text)', minHeight: 88,
              }}
            >
              <MenuSticker type={t.value} size={40} />
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{t.desc}</div>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
