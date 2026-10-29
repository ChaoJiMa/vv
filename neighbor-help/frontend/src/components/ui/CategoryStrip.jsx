import { MenuSticker } from '../icons'

/**
 * 分类贴纸横滑条
 * - mode "entry"：首页入口（可带今日新帖角标）
 * - mode "filter"：发现筛选（选中缩放 + 描边）
 */
export default function CategoryStrip({
  menus = [],
  mode = 'entry',
  active = '',
  onSelect,
  hotByType,
  className,
  style,
}) {
  const filterMode = mode === 'filter'
  const stripClass = className || (filterMode ? 'nh-discover-cats' : 'nh-entry-strip')

  return (
    <section
      className={stripClass}
      style={{
        position: 'relative',
        display: 'flex',
        gap: filterMode ? 12 : 14,
        padding: filterMode ? '12px 0 4px' : '4px 16px 14px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        ...style,
      }}
    >
      {filterMode && (
        <FilterAll active={active === ''} onClick={() => onSelect?.('')} />
      )}
      {menus.map((m) => (
        filterMode ? (
          <FilterItem
            key={m.value}
            menu={m}
            active={active === m.value}
            onClick={() => onSelect?.(m.value)}
          />
        ) : (
          <EntryItem
            key={m.value}
            menu={m}
            hot={!!hotByType?.[m.value]}
            onClick={() => onSelect?.(m.value)}
          />
        )
      ))}
      <style>{`
        .${stripClass}::-webkit-scrollbar { display: none; }
      `}</style>
    </section>
  )
}

function EntryItem({ menu, hot, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        width: 76,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        padding: '4px 0 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-text)',
      }}
    >
      <span style={{ position: 'relative', display: 'inline-flex', width: 48, height: 48 }}>
        <MenuSticker type={menu.value} size={48} />
        {hot ? (
          <span
            aria-label="今日有新帖"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--color-primary)',
              border: '1.5px solid var(--color-surface)',
              boxSizing: 'border-box',
            }}
          />
        ) : null}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{menu.label}</span>
    </button>
  )
}

function FilterAll({ active, onClick }) {
  return (
    <button
      type="button"
      className="nh-discover-cat"
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        width: 72,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        padding: '2px 0 6px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-text)',
        transform: active ? 'scale(1.04)' : 'scale(1)',
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 800,
          background: active ? 'var(--color-primary)' : 'var(--color-bg-accent)',
          color: active ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
          boxShadow: active
            ? '0 0 0 2.5px color-mix(in srgb, var(--color-primary) 40%, transparent)'
            : '0 0 0 2px transparent',
          transition: 'background 200ms ease, color 200ms ease, box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        全
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: active ? 700 : 600,
          transition: 'font-weight 180ms ease',
        }}
      >
        全部
      </span>
    </button>
  )
}

function FilterItem({ menu, active, onClick }) {
  return (
    <button
      type="button"
      className="nh-discover-cat"
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        width: 76,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        padding: '2px 0 6px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-text)',
        transform: active ? 'scale(1.04)' : 'scale(1)',
      }}
    >
      <span
        style={{
          borderRadius: 16,
          lineHeight: 0,
          boxShadow: active ? '0 0 0 2.5px var(--color-primary)' : '0 0 0 2.5px transparent',
          transition: 'box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <MenuSticker type={menu.value} size={44} />
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: active ? 700 : 600,
          transition: 'font-weight 180ms ease',
        }}
      >
        {menu.label}
      </span>
    </button>
  )
}
