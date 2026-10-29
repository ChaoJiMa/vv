import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { coverAspectRatio, coverKey } from '../../utils/image'
import {
  CARD_GAP, clampAspect, estimateCardHeight, loadImageAspect, NO_IMAGE_ASPECT,
} from '../../utils/imageAspect'

/**
 * 双列瀑布流：按当前较矮列放置；优先用 cover 宽高，否则预加载。
 */
export default function Waterfall({
  items,
  renderItem,
  gap = CARD_GAP,
  style,
}) {
  const wrapRef = useRef(null)
  const aspectRef = useRef({})
  const [colWidth, setColWidth] = useState(160)
  const [aspectMap, setAspectMap] = useState(() => ({}))
  const itemKey = items.map((i) => i.id).join(',')

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

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const jobs = []
      for (const item of items) {
        if (aspectRef.current[item.id] != null) continue
        const known = coverAspectRatio(item)
        if (known != null) {
          const aspect = clampAspect(known)
          aspectRef.current[item.id] = aspect
          jobs.push(Promise.resolve({ id: item.id, aspect }))
          continue
        }
        const thumb = coverKey(item)
        if (!thumb) {
          aspectRef.current[item.id] = NO_IMAGE_ASPECT
          jobs.push(Promise.resolve({ id: item.id, aspect: NO_IMAGE_ASPECT }))
          continue
        }
        jobs.push(
          loadImageAspect(api.imgUrl(thumb)).then((aspect) => {
            aspectRef.current[item.id] = aspect
            return { id: item.id, aspect }
          })
        )
      }
      if (!jobs.length) return
      const resolved = await Promise.all(jobs)
      if (cancelled) return
      setAspectMap((prev) => {
        const next = { ...prev }
        for (const { id, aspect } of resolved) next[id] = aspect
        return next
      })
    }
    run()
    return () => { cancelled = true }
  }, [itemKey, items])

  const columns = useMemo(() => {
    const left = []
    const right = []
    if (!colWidth) return [left, right]
    const heights = [0, 0]
    for (const item of items) {
      const known = coverAspectRatio(item)
      const aspect = aspectMap[item.id] ?? (
        known != null
          ? clampAspect(known)
          : (coverKey(item) ? 1 : NO_IMAGE_ASPECT)
      )
      const h = estimateCardHeight(colWidth, aspect)
      const i = heights[0] <= heights[1] ? 0 : 1
      ;(i === 0 ? left : right).push({ item, aspect })
      heights[i] += h
    }
    return [left, right]
  }, [items, aspectMap, colWidth])

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
            {columns[col].map(({ item, aspect }, idx) => (
              <div
                key={item.id}
                className="nh-waterfall-card"
                style={{ animationDelay: `${Math.min(col + idx * 2, 14) * 45}ms` }}
              >
                {renderItem(item, { aspect, colWidth })}
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
