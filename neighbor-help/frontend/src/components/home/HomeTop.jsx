import { MegaphoneIcon } from '../icons'
import CategoryStrip from '../ui/CategoryStrip'
import TitleDoodle from '../ui/TitleDoodle'
import useDisplayFont from '../../hooks/useDisplayFont'
import { displayName } from '../../utils/displayName'

function greetingByHour() {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 首页文档流透出全局柔光；糖果色只留在分类卡和品牌小装饰内，不另画页级背景。 */
export default function HomeTop({
  user,
  todayCount = 0,
  total = 0,
  noticeSummary = '',
  onNoticeClick,
  menus = [],
  hotByType,
  onPickCategory,
}) {
  const { ready, fontFamily } = useDisplayFont()
  return (
    <div className="nh-home-top" style={{ position: 'relative', overflow: 'hidden', background: 'transparent' }}>
      <section
        className="nh-home-hero"
        style={{
          position: 'relative',
          padding: 'calc(var(--page-heading-top) + var(--safe-top)) 16px 10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 400, lineHeight: 'var(--page-heading-height)',
              color: 'var(--color-primary)', letterSpacing: '0.02em',
              // 字标行与其他主页面的操作行共用44px高度；下方文案单独保留16px留白。
              display: 'flex', alignItems: 'center', gap: 8, height: 'var(--page-heading-height)',
            }}>
              {/* 与发现 / 消息相同，只等待品牌文字，卷线、问候与操作不受字体加载阻塞。 */}
              <span className="nh-home-wordmark" style={{ whiteSpace: 'nowrap', fontFamily, visibility: ready ? 'visible' : 'hidden' }}>邻里里</span>
              <TitleDoodle />
            </div>
            <div style={{
              // 单独保留字标与问候文案的留白，不改变字号、卷线或标题起点。
              marginTop: 16, fontSize: 15, fontWeight: 600, color: 'var(--color-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {greetingByHour()}，{user ? displayName(user) : '邻居'}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
              今日新发 {todayCount} · 累计 {total}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onNoticeClick}
          style={{
            marginTop: 14,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--color-text-muted)',
          }}
        >
          <MegaphoneIcon size={18} style={{ color: 'var(--color-text-muted)' }} />
          <span style={{
            flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {noticeSummary}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, flexShrink: 0 }}>全部</span>
        </button>
      </section>

      <CategoryStrip
        mode="entry"
        menus={menus}
        hotByType={hotByType}
        onSelect={onPickCategory}
      />
    </div>
  )
}
