import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Which tabs fit on the row, by index in order: as many from the start as
 * the room takes, given each tab's width and the gap between two tabs. The
 * tab at `keep` (the one on show) always stays, in its place, and the others
 * fit around it. With no room measured yet (0) every tab shows.
 */
export function tabsThatFit(
  widths: readonly number[],
  gap: number,
  room: number,
  keep: number
): number[] {
  const all = widths.map((_, index) => index)
  if (room <= 0) return all
  const shown = keep >= 0 && keep < widths.length ? [keep] : []
  let used = shown.length > 0 ? widths[keep] : 0
  for (const index of all) {
    if (index === keep) continue
    const next = used + (shown.length > 0 ? gap : 0) + widths[index]
    if (next > room) break
    used = next
    shown.push(index)
  }
  return shown.sort((a, b) => a - b)
}

interface Row {
  /** Each tab's width, by key, measured while it showed. */
  widths: Readonly<Record<string, number>>
  gap: number
  room: number
}

/**
 * The keys of the tabs that fit on a tab row's line (see `tabsThatFit`), so
 * the rest can go in its menu rather than scroll out of sight. `tabs` is the
 * row's root: its tabs are measured while they show, and the room is its
 * width less what follows the tabs (`.ui-tabs__trailing`), checked again as
 * it resizes. Every tab shows until each has been measured once.
 */
export function useTabsThatFit(
  tabs: RefObject<HTMLElement | null>,
  keys: readonly string[],
  keep: string
): readonly string[] {
  const [row, setRow] = useState<Row>({ widths: {}, gap: 0, room: 0 })
  const measured = keys.every((key) => row.widths[key] !== undefined)
  const shown = measured
    ? tabsThatFit(
        keys.map((key) => row.widths[key]),
        row.gap,
        row.room,
        keys.indexOf(keep)
      ).map((index) => keys[index])
    : keys

  // After every render, as the tabs on show or their labels may have
  // changed, and whenever the row resizes.
  const measure = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    measure.current = () => {
      const root = tabs.current
      if (!root) return
      const list = root.querySelector<HTMLElement>('[role="tablist"]')
      const trailing = root.querySelector<HTMLElement>('.ui-tabs__trailing')
      const gap = list ? parseFloat(getComputedStyle(list).columnGap) || 0 : 0
      // A pixel spare, so rounding never tips the last tab into a scroll.
      const room = Math.max(0, root.clientWidth - (trailing?.offsetWidth ?? 0) - 1)
      setRow((current) => {
        let widths = current.widths
        root.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab, index) => {
          const key = shown[index]
          const width = tab.getBoundingClientRect().width
          if (key === undefined || Math.abs((widths[key] ?? -1) - width) < 0.5) return
          widths = { ...widths, [key]: width }
        })
        const same = widths === current.widths && gap === current.gap && room === current.room
        return same ? current : { widths, gap, room }
      })
    }
    measure.current()
  })
  useLayoutEffect(() => {
    const root = tabs.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure.current())
    observer.observe(root)
    return () => observer.disconnect()
  }, [tabs])

  return shown
}
