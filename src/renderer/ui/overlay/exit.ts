/**
 * Closing animations for overlays.
 *
 * React removes a closed overlay at once, so focus return, layers and tests all
 * see it close straight away. To animate the close, a copy of the overlay's
 * last frame is put back in its place with `.is-leaving`, plays the leave
 * animation (overlay.css, Drawer.css), and removes itself. The copy is inert,
 * hidden from assistive tech and lets clicks through. With reduced motion the
 * motion tokens are 0 and no copy is made.
 */

import { motionMs } from '../motion'

/** What cloneNode leaves behind: scroll positions and typed values. */
function copyLiveState(from: Element, to: Element): void {
  if (from.scrollTop || from.scrollLeft) {
    to.scrollTop = from.scrollTop
    to.scrollLeft = from.scrollLeft
  }
  if (
    from instanceof HTMLInputElement ||
    from instanceof HTMLTextAreaElement ||
    from instanceof HTMLSelectElement
  ) {
    ;(to as typeof from).value = from.value
  }
  const fromChildren = from.children
  const toChildren = to.children
  for (let i = 0; i < fromChildren.length && i < toChildren.length; i++) {
    copyLiveState(fromChildren[i], toChildren[i])
  }
}

export interface ExitOptions {
  /**
   * For a node laid out in a list rather than fixed by its own classes (a
   * toast): the copy is pinned where the node was, on this z-index. Only works
   * while the node is still in the document, i.e. from an unmount cleanup.
   */
  pinnedAbove?: string
}

/**
 * Plays the leave animation for `node`, an overlay React is removing or has
 * just removed. Without `pinnedAbove` the node must position itself (fixed)
 * from its own classes and inline style, as every overlay rendered through
 * Portal does.
 */
export function playExit(node: HTMLElement | null, options: ExitOptions = {}): void {
  if (!node || typeof document === 'undefined') return
  const duration = motionMs('--motion-fast')
  if (duration <= 0) return
  const rect = options.pinnedAbove ? node.getBoundingClientRect() : null
  if (rect && rect.width === 0 && rect.height === 0) return

  const ghost = node.cloneNode(true) as HTMLElement
  if (rect) {
    Object.assign(ghost.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      zIndex: options.pinnedAbove
    })
  }
  ghost.classList.add('is-leaving')
  // A picture only: nothing that asks "is a dialog open?" (utils/dom.ts, the
  // board's keys) or looks up an id may find it.
  for (const element of [ghost, ...ghost.querySelectorAll('*')]) {
    for (const name of ['id', 'role', 'aria-modal', 'data-ui-layer', 'data-autofocus'])
      element.removeAttribute(name)
  }
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  document.body.append(ghost)
  // Scroll positions only take once the copy is laid out.
  copyLiveState(node, ghost)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    ghost.remove()
  }
  // Every leave animation is --motion-fast; the timer covers one that never
  // runs (display: none inside, or a browser that skips it).
  window.setTimeout(remove, duration + 100)
  const animations = ghost.getAnimations?.({ subtree: true }) ?? []
  if (animations.length === 0) remove()
  else void Promise.all(animations.map((animation) => animation.finished)).then(remove, remove)
}
