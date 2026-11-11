import { GridIcon, MenuSticker } from '../icons'
import { getTypeTheme } from '../../utils/typeTheme'

/**
 * 原布局分类入口：糖果底色与胶质角色提供亲和感，文字与选中描边继续说明业务及状态。
 * - mode "entry"：首页入口（可带今日新帖角标）
 * - mode "filter"：发现筛选（选中颜色 + 描边，保持图形尺寸稳定）
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
      className={`nh-category-strip ${stripClass}`}
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
        .nh-category-strip::-webkit-scrollbar { display: none; }
        .nh-category-option:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; border-radius: 12px; }
      `}</style>
    </section>
  )
}

function EntryItem({ menu, hot, onClick }) {
  const theme = getTypeTheme(menu.value, menu)
  return (
    <button
      type="button"
      className="nh-category-option"
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
      <span style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 48, height: 48, borderRadius: 15, boxSizing: 'border-box',
        border: '1px solid transparent', background: theme.cardBg, color: theme.pillFg,
        boxShadow: theme.cardShadow,
      }}>
        <MenuSticker type={menu.value} size={44} />
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
              zIndex: 1,
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
      className="nh-discover-cat nh-category-option"
      aria-pressed={active}
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
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 800,
          boxSizing: 'border-box',
          border: `1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
          background: active ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
          color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
          transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
        }}
      >
        <GridIcon size={26} />
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
  const theme = getTypeTheme(menu.value, menu)
  return (
    <button
      type="button"
      className="nh-discover-cat nh-category-option"
      aria-pressed={active}
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
      }}
    >
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          width: 44, height: 44, borderRadius: 14, boxSizing: 'border-box',
          lineHeight: 0,
          border: `1.5px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
          background: theme.cardBg,
          color: theme.pillFg,
          boxShadow: theme.cardShadow,
          transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
        }}
      >
        <MenuSticker type={menu.value} size={40} />
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
