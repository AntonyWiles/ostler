import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { parseAppPath } from '../navigation/paths'
import { useAnnounce } from '../ui'

/**
 * Focus after navigation (P9.2, WCAG 2.4.3): a new page puts focus on its
 * heading and says where you are, so keyboard and screen-reader users start
 * at the top of what changed rather than at the sidebar link they left.
 *
 * Focus stays put when the control that navigated is still on screen inside
 * the page, such as a project's tabs or the Settings list: moving it would
 * lose the person's place. The page change is still said aloud.
 */

/** The id of the content area: the skip link's target. */
export const MAIN_CONTENT_ID = 'main-content'

/** How long to wait for a page that loads its code on first use. */
const HEADING_WAIT_MS = 3000

/** The page's heading, or the content area itself when it has none yet. */
export function pageFocusTarget(main: HTMLElement): HTMLElement {
  return main.querySelector<HTMLElement>('h1') ?? main
}

/** Focuses `target` without scrolling, making it focusable first if it is not. */
export function focusWithoutScroll(target: HTMLElement): void {
  if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus({ preventScroll: true })
}

/** Moves focus to the page heading (the skip link's action). */
export function focusPageContent(): void {
  const main = document.getElementById(MAIN_CONTENT_ID)
  if (main) focusWithoutScroll(pageFocusTarget(main))
}

/** True when focus is on something the new page still shows: leave it there. */
function focusStaysInPage(main: HTMLElement): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return false
  if (active.closest('[role="dialog"], [role="alertdialog"]')) return true
  return active.isConnected && main.contains(active)
}

/**
 * Runs on every path change after the first: says `where`, and moves focus to
 * the new page's heading unless it should stay (see above). A task's drawer
 * handles its own focus.
 */
export function useRouteFocus(where: string | null): void {
  const location = useLocation()
  const announce = useAnnounce()
  const previous = useRef<string | null>(null)
  const whereRef = useRef(where)
  whereRef.current = where

  useEffect(() => {
    const from = previous.current
    previous.current = location.pathname
    // The first page, and `/` redirecting to it, is where the app opens:
    // focus starts at the top, so Skip to content is the first Tab stop.
    if (from === null || from === '/') return
    const here = parseAppPath(location.pathname)
    if (here?.kind === 'task') return
    const main = document.getElementById(MAIN_CONTENT_ID)
    if (!main) return
    const moveFocus = !focusStaysInPage(main)

    let done = false
    let observer: MutationObserver | null = null
    const finish = (target: HTMLElement) => {
      if (done) return
      done = true
      observer?.disconnect()
      clearTimeout(timer)
      if (moveFocus && !focusStaysInPage(main)) focusWithoutScroll(target)
      if (whereRef.current) announce(whereRef.current)
    }
    const tryHeading = () => {
      const heading = main.querySelector<HTMLElement>('h1')
      if (heading) finish(heading)
    }
    // A page that loads its code on first use has no heading yet: wait for it.
    const timer = setTimeout(() => finish(pageFocusTarget(main)), HEADING_WAIT_MS)
    tryHeading()
    if (!done) {
      observer = new MutationObserver(tryHeading)
      observer.observe(main, { childList: true, subtree: true })
    }
    return () => {
      done = true
      observer?.disconnect()
      clearTimeout(timer)
    }
  }, [location.pathname])
}
