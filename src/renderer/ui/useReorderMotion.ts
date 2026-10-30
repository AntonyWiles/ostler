import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { motionEasing, motionMs } from './motion'

interface Snapshot {
  at: number
  order: string[]
  places: Map<string, { x: number; y: number }>
}

/** How long a snapshot waits for the order to change: saves can take a round trip. */
const PENDING_MS = 1500

function itemsIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-motion-key]')]
}

function snapshot(container: HTMLElement): Snapshot {
  const origin = container.getBoundingClientRect()
  const places = new Map<string, { x: number; y: number }>()
  const items = itemsIn(container)
  for (const item of items) {
    const rect = item.getBoundingClientRect()
    places.set(item.dataset.motionKey!, {
      x: rect.left - origin.left + container.scrollLeft,
      y: rect.top - origin.top + container.scrollTop
    })
  }
  return { at: Date.now(), order: items.map((item) => item.dataset.motionKey!), places }
}

/**
 * Whether the items in both lists come in a different order. Items that only
 * appeared or went (a fold opening or shutting, a new row) are not a reorder.
 */
function reordered(before: string[], after: string[]): boolean {
  const kept = new Set(after)
  const was = before.filter((key) => kept.has(key))
  const had = new Set(before)
  const now = after.filter((key) => had.has(key))
  return was.some((key, index) => key !== now[index])
}

/**
 * Items slide to their new places when a list is reordered, instead of
 * jumping. Mark each item with `data-motion-key` (a stable id) inside
 * `containerRef`, and call this in the component that renders them.
 *
 * Where everything stood is noted on every drop, click or key press (in the
 * page, so a Move up in a context menu counts), i.e. just before the reorder
 * it causes. On the next render where items have changed order, each one
 * that moved slides from there (FLIP). Moves between lists inside the same container slide too.
 */
export function useReorderMotion(containerRef: RefObject<HTMLElement | null>): void {
  const pending = useRef<Snapshot | null>(null)

  useEffect(() => {
    const note = (event: Event) => {
      // Of the keys, only those that act: typing must not measure the page.
      if (
        event instanceof KeyboardEvent &&
        !event.altKey &&
        event.key !== 'Enter' &&
        event.key !== ' '
      )
        return
      const container = containerRef.current
      if (container && motionMs('--motion-normal') > 0) pending.current = snapshot(container)
    }
    const events = ['drop', 'click', 'keydown'] as const
    for (const type of events) document.addEventListener(type, note, true)
    return () => {
      for (const type of events) document.removeEventListener(type, note, true)
    }
  }, [containerRef])

  useLayoutEffect(() => {
    const before = pending.current
    const container = containerRef.current
    if (!before || !container) return
    if (Date.now() - before.at > PENDING_MS) {
      pending.current = null
      return
    }
    const after = snapshot(container)
    if (!reordered(before.order, after.order)) return
    pending.current = null
    const timing = { duration: motionMs('--motion-normal'), easing: motionEasing() }
    // Document order puts a group before the items inside it. An item inside a
    // group that slides already moves with it, so it only adds its own part.
    const slid = new Map<HTMLElement, { dx: number; dy: number }>()
    for (const item of itemsIn(container)) {
      const from = before.places.get(item.dataset.motionKey!)
      const to = after.places.get(item.dataset.motionKey!)
      if (!from || !to) continue
      const group = item.parentElement?.closest<HTMLElement>('[data-motion-key]')
      const carried = (group && slid.get(group)) ?? { dx: 0, dy: 0 }
      const dx = from.x - to.x
      const dy = from.y - to.y
      slid.set(item, { dx, dy })
      const ownX = dx - carried.dx
      const ownY = dy - carried.dy
      if (Math.abs(ownX) < 1 && Math.abs(ownY) < 1) continue
      item.animate(
        [{ transform: `translate(${ownX}px, ${ownY}px)` }, { transform: 'none' }],
        timing
      )
    }
  })
}
