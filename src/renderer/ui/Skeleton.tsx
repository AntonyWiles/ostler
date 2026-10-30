import { useEffect, useState, type CSSProperties } from 'react'
import { cx } from './cx'
import './Skeleton.css'

/** Loading that finishes sooner than this shows nothing, so fast loads do not flicker. */
export const SKELETON_DELAY_MS = 300

export interface SkeletonProps {
  /** Number of text lines; the last is shorter. */
  lines?: number
  /** A block instead of lines: any CSS length. */
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  shape?: 'text' | 'block' | 'circle'
  className?: string
}

/**
 * A content-shaped placeholder. It stays invisible for the first 300 ms of
 * loading, then appears. Hidden from assistive tech: say "Loading" elsewhere
 * (aria-busy on the region) if it matters.
 */
export function Skeleton({ lines = 1, width, height, shape = 'text', className }: SkeletonProps) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  const count = shape === 'text' ? Math.max(1, lines) : 1
  return (
    <span
      aria-hidden="true"
      data-visible={visible}
      className={cx('ui-skeleton', `ui-skeleton--${shape}`, className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="ui-skeleton__bone"
          style={{
            width: shape === 'text' && count > 1 && index === count - 1 ? '60%' : width,
            height
          }}
        />
      ))}
    </span>
  )
}
