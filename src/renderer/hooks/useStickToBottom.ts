import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** How far from the bottom still counts as "at the bottom", absorbing sub-pixel rounding. */
const BOTTOM_THRESHOLD_PX = 24

/**
 * Follows streaming output the way a terminal does. While the reader is at the
 * bottom, new content keeps the view pinned there; scrolling up releases it, so
 * output that keeps arriving no longer drags them back down; scrolling back to
 * the bottom picks it up again.
 *
 * Attach `ref` and `onScroll` to the scrolling element and pass something that
 * changes whenever its content does as `trigger`. Every auto-following view in
 * Ostler should use this rather than setting `scrollTop` itself, so they all
 * behave the same.
 *
 * `stuck` is exposed for a UI that shows the state (and `setStuck(false)` lets
 * a control pause following without the reader having to scroll).
 */
export function useStickToBottom<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null)
  const stuckRef = useRef(true)
  const [stuck, setStuckState] = useState(true)

  const setStuck = useCallback((next: boolean) => {
    stuckRef.current = next
    setStuckState(next)
  }, [])

  // Only a real scroll can change the answer: content growing never fires a
  // scroll event, so a reader sitting at the bottom is not mistaken for one who
  // left just because a large chunk arrived.
  const onScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX
    if (atBottom !== stuckRef.current) setStuck(atBottom)
  }, [setStuck])

  useLayoutEffect(() => {
    const element = ref.current
    if (element && stuckRef.current) element.scrollTop = element.scrollHeight
  }, [trigger])

  /** Jump to the end and follow again, e.g. when the reader starts a new run. */
  const scrollToBottom = useCallback(() => {
    setStuck(true)
    const element = ref.current
    if (element) element.scrollTop = element.scrollHeight
  }, [setStuck])

  return { ref, onScroll, stuck, setStuck, scrollToBottom }
}
