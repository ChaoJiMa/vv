import Skeleton from './Skeleton'

/** 双列瀑布骨架（暖色低对比） */
export default function WaterfallSkeleton() {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton height={180} />
        <Skeleton height={140} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton height={140} />
        <Skeleton height={180} />
      </div>
    </div>
  )
}
