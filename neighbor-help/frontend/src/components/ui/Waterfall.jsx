import { useEffect, useMemo, useRef, useState } from 'react'
import { coverAspectRatio, coverKey } from '../../utils/image'
import {
  CARD_GAP, clampAspect, estimateCardHeight, NO_IMAGE_ASPECT,
} from '../../utils/imageAspect'

/**
 * 双列瀑布流：按当前较矮列放置；旧图片缺少尺寸时使用稳定的方形占位。
 */
export default function Waterfall({
  items,
  renderItem,
  gap = CARD_GAP,
  style,
}) {
  const wrapRef = useRef(null)
  const [colWidth, setColWidth] = useState(160)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => {
      const w = el.clientWidth
      setColWidth(Math.max(0, Math.floor((w - gap) / 2)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [gap])

  const columns = useMemo(() => {
    const left = []
    const right = []
    if (!colWidth) return [left, right]
    const heights = [0, 0]
    for (const [index, item] of items.entries()) {
      const known = coverAspectRatio(item)
      const aspect = (
        known != null
          ? clampAspect(known)
          : (coverKey(item) ? 1 : NO_IMAGE_ASPECT)
      )
      const h = estimateCardHeight(colWidth, aspect)
      const i = heights[0] <= heights[1] ? 0 : 1
      ;(i === 0 ? left : right).push({ item, aspect, priority: index < 2 })
      heights[i] += h
    }
    return [left, right]
  }, [items, colWidth])

  return (
    <>
      <div
        ref={wrapRef}
        className="nh-waterfall"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap,
          width: '100%',
          ...style,
        }}
      >
        {[0, 1].map((col) => (
          <div
            key={col}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap,
            }}
          >
            {columns[col].map(({ item, aspect, priority }, idx) => (
              <div
                key={item.id}
                className="nh-waterfall-card"
                style={{ animationDelay: `${Math.min(col + idx * 2, 14) * 45}ms` }}
              >
                {renderItem(item, { aspect, colWidth, priority })}
              </div>
            ))}
          </div>
        ))}
      </div>
      <style>{`
        .nh-waterfall-card {
          animation: nhWaterfallIn 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes nhWaterfallIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nh-waterfall-card { animation: none !important; }
        }
      `}</style>
    </>
  )
}
