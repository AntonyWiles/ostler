import { useEffect } from 'react'
import { PERF_MARKS, type PerfMark } from '@shared/perf-marks'
import { onFirstScreen } from './first-screen'

/** Sets a `performance.mark`, with optional detail. Never throws. */
export function markPerf(name: PerfMark, detail?: Record<string, unknown>): void {
  if (name === PERF_MARKS.homeRendered || name === PERF_MARKS.projectViewRendered) {
    onFirstScreen()
  }
  try {
    performance.mark(name, detail ? { detail } : undefined)
  } catch {
    // A mark is only ever a measurement.
  }
}

/**
 * Marks `name` once the screen has painted after `ready` became true, and
 * again whenever `key` changes while ready (a project or view switch). The
 * mark waits one animation frame, so it falls after the paint, not before it.
 */
export function useRenderedMark(
  name: PerfMark,
  ready: boolean,
  key: string,
  detail?: Record<string, unknown>
): void {
  useEffect(() => {
    if (!ready) return
    const frame = requestAnimationFrame(() => markPerf(name, { key, ...detail }))
    return () => cancelAnimationFrame(frame)
  }, [name, ready, key])
}
