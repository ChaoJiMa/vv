import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import Button from '../ui/Button'
import CategoryStrip from '../ui/CategoryStrip'
import { displayName } from '../../utils/displayName'

function greetingByHour() {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 首页顶区：品牌 + 公告 + 分类，同一渐变带 */
export default function HomeTop({
  user,
  todayCount = 0,
  total = 0,
  noticeSummary = '',
  onNoticeClick,
  onLogin,
  menus = [],
  hotByType,
  onPickCategory,
}) {
  return (
    <div className="nh-home-top" style={{ position: 'relative', overflow: 'hidden' }}>
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--color-primary) 16%, var(--color-bg)) 0%,
              color-mix(in srgb, var(--color-accent-cream, #F5E6C8) 28%, var(--color-bg)) 38%,
              var(--color-bg) 100%
            )
          `,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', top: -36, right: -28, width: 140, height: 140, borderRadius: '50%',
          background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', top: '42%', left: -24, width: 88, height: 88, borderRadius: '50%',
          background: 'color-mix(in srgb, var(--color-accent-mint, #C6ECDC) 32%, transparent)',
        }}
      />

      <section
        className="nh-home-hero"
        style={{
          position: 'relative',
          padding: 'calc(20px + var(--safe-top)) 16px 10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 400, lineHeight: 1.05,
              color: 'var(--color-primary)', letterSpacing: '0.02em',
            }}>
              邻里里
            </div>
            <div style={{
              marginTop: 8, fontSize: 15, fontWeight: 600, color: 'var(--color-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {greetingByHour()}，{user ? displayName(user) : '邻居'}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
              今日新发 {todayCount} · 累计 {total}
            </div>
          </div>
          {!user && (
            <Button
              type="button"
              variant="secondary"
              onClick={onLogin}
              style={{ minHeight: 36, padding: '6px 14px', flexShrink: 0 }}
            >
              登录
            </Button>
          )}
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
          <CampaignOutlinedIcon sx={{ fontSize: 18, color: 'var(--color-primary)', flexShrink: 0 }} />
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
