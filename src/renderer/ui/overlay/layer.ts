import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { useDismissable, type DismissableBackdropProps } from '../../hooks/useDismissable'
import { playExit } from './exit'
import { computePosition, type Placement, type Viewport } from './position'
import './overlay.css'

/*
 * The one overlay layer every component in src/renderer/ui/ builds on.
 *
 * Escape, click-outside and the "which overlay is on top" question all go
 * through useDismissable, the same stack the older modals use, so a Dialog
 * opened over a legacy modal (or the reverse) closes in the right order. On
 * top of that: a focus trap and scroll lock for modal layers, and anchored
 * positioning for the non-modal ones.
 */

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',')

/** Elements inside `root` that Tab can reach, in DOM order. */
export function tabbableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) =>
      !element.closest('[hidden], [inert]') && element.getAttribute('aria-hidden') !== 'true'
  )
}

let scrollLocks = 0
let savedOverflow = ''

/** Stops the page behind a modal from scrolling. Counted, so nested modals unlock once. */
function useScrollLock(): void {
  useEffect(() => {
    if (scrollLocks === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    scrollLocks += 1
    return () => {
      scrollLocks -= 1
      if (scrollLocks === 0) document.body.style.overflow = savedOverflow
    }
  }, [])
}

/** How long returned focus waits for a control busy with the action that closed the layer. */
const RETURN_WAIT_MS = 10_000
const RETURN_POLL_MS = 50

function focusIsLost(): boolean {
  // A deferred check can outlive the page (a test environment torn down).
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  return !active || active === document.body || active === document.documentElement
}

/**
 * Gives focus back when a modal layer closes (WCAG 2.4.3): to the first of
 * `candidates` still on the page. One that is disabled for now (the opener,
 * busy with the action that closed the layer) takes focus once it is enabled
 * again, and meanwhile the dialog it sits in, if any, holds focus. With none on
 * the page, they are asked once more a moment later, for a replacement that
 * renders just after the layer closes.
 */
function returnFocus(
  panel: HTMLElement,
  candidates: () => (HTMLElement | null | undefined)[],
  retry = true
): void {
  const present = candidates().filter(
    (element): element is HTMLElement =>
      !!element && element !== document.body && element.isConnected && !panel.contains(element)
  )
  const ready = present.find((element) => !element.matches(':disabled'))
  if (ready) {
    ready.focus()
    return
  }
  const waiting = present[0]
  if (!waiting) {
    if (retry) {
      window.setTimeout(() => {
        if (focusIsLost()) returnFocus(panel, candidates, false)
      }, RETURN_POLL_MS)
    }
    return
  }
  const holder = waiting.parentElement?.closest<HTMLElement>('[aria-modal="true"]') ?? null
  holder?.focus()
  const until = Date.now() + RETURN_WAIT_MS
  const check = () => {
    // Someone moved focus on, the control went, or it stayed busy too long.
    if (typeof document === 'undefined') return
    if (!(focusIsLost() || document.activeElement === holder)) return
    if (!waiting.isConnected || Date.now() > until) return
    if (waiting.matches(':disabled')) window.setTimeout(check, RETURN_POLL_MS)
    else waiting.focus()
  }
  window.setTimeout(check, RETURN_POLL_MS)
}

export interface ModalLayerOptions {
  onClose: () => void
  /** False while busy: Escape and the backdrop do nothing (see useDismissable). */
  canDismiss?: boolean
  /** False when a stray backdrop click would lose work. Escape still closes. */
  closeOnBackdrop?: boolean
  /** What to focus first. Otherwise `[data-autofocus]`, then the first tabbable, then the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /**
   * Where focus goes back to when the opener has gone or been re-created while
   * the layer was open (a task's card that moved column while it was edited, a
   * "Set up" button that became "Change"). Read when the layer closes, after
   * the opener and what had focus at mount, and once more just after.
   */
  returnFocusTo?: () => HTMLElement | null
}

export interface ModalLayer {
  backdropProps: DismissableBackdropProps
  panelRef: RefObject<HTMLDivElement | null>
  /** Spread onto the panel: keeps Tab and Shift+Tab inside it. */
  onPanelKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

/**
 * Focus trap, Escape, backdrop click, scroll lock and focus return for a modal
 * (Dialog, Drawer). Mount the component that calls this only while it is open.
 */
export function useModalLayer({
  onClose,
  canDismiss = true,
  closeOnBackdrop = true,
  initialFocusRef,
  returnFocusTo
}: ModalLayerOptions): ModalLayer {
  // Read during the first render, before anything inside the layer can take
  // focus (an autoFocus field focuses during commit, ahead of every effect).
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  )
  const backdropProps = useDismissable(onClose, { canDismiss, closeOnBackdrop })
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The effect below runs once, so it reads the latest function through this ref.
  const returnTo = useRef(returnFocusTo)
  returnTo.current = returnFocusTo
  useScrollLock()

  // The layer unmounts when it closes; its last frame fades out (exit.ts).
  useLayoutEffect(() => {
    const backdrop = backdropProps.ref.current
    return () => playExit(backdrop)
  }, [])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    // A second candidate for where focus goes back to: what had focus once
    // the layer mounted. It covers an opener that was itself removed in the
    // same update (a menu item that opened this dialog and closed its menu,
    // which hands focus back to the menu's button).
    const settled = document.activeElement as HTMLElement | null
    if (!panel.contains(document.activeElement)) {
      const target =
        initialFocusRef?.current ??
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        tabbableIn(panel)[0] ??
        panel
      target.focus()
    }
    return () => returnFocus(panel, () => [opener, settled, returnTo.current?.()])
    // Mount and unmount only: the layer lives exactly as long as it is open.
  }, [])

  const onPanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return
    const items = tabbableIn(panelRef.current)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  return { backdropProps, panelRef, onPanelKeyDown }
}

export interface AnchoredLayerOptions {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  placement?: Placement
  /** Make the overlay at least as wide as its anchor (combobox lists). */
  matchWidth?: boolean
  /** A fixed point instead of the anchor's box (context menus). */
  point?: { x: number; y: number } | null
}

export interface AnchoredLayer {
  floatingRef: RefObject<HTMLDivElement | null>
  style: CSSProperties
}

/** Each open anchored layer's anchor, so a layer can tell the ones opened from inside it. */
const layerAnchors = new WeakMap<Element, Element>()

/**
 * Whether `target` is in a layer opened from inside `panel`, however deep: a
 * combobox's list in a popover is rendered at the end of the page, but a
 * click on it is not a click outside the popover.
 */
function inLayerOpenedFrom(panel: Element, target: Node): boolean {
  const start = target instanceof Element ? target : target.parentElement
  let layer = start?.closest('.ui-floating')
  while (layer && layer !== panel) {
    const anchor = layerAnchors.get(layer)
    if (!anchor) return false
    if (panel.contains(anchor)) return true
    layer = anchor.closest('.ui-floating')
  }
  return false
}

/** The z-index of the dialog or drawer an element is in; undefined on the page itself. */
export function layerOf(element: Element | null): number | undefined {
  const host = element?.closest<HTMLElement>('[data-ui-layer]')
  if (!host) return undefined
  const z = Number.parseInt(getComputedStyle(host).zIndex, 10)
  return Number.isFinite(z) ? z : undefined
}

/**
 * The z-index an overlay opened from inside another layer needs: one above
 * that layer, so a menu in a dialog is not drawn behind the dialog. A layer
 * opened from inside another overlay (Quick dates in a checklist item's panel,
 * in the task drawer) goes one above that overlay, which may itself sit above
 * a drawer: without it the inner one opened behind the drawer (MOP-40).
 */
function layerAbove(anchor: Element | null): number | undefined {
  const floating = anchor?.closest<HTMLElement>('.ui-floating')
  const z = floating
    ? Number.parseInt(floating.style.zIndex || getComputedStyle(floating).zIndex, 10)
    : layerOf(anchor)
  return z === undefined || !Number.isFinite(z) ? undefined : z + 1
}

/**
 * Escape, click-outside and positioning for a non-modal overlay anchored to an
 * element (Popover, Menu, Combobox list) or to a point (ContextMenu).
 */
export function useAnchoredLayer({
  open,
  onClose,
  anchorRef,
  placement = 'bottom-start',
  matchWidth = false,
  point = null
}: AnchoredLayerOptions): AnchoredLayer {
  const { ref: floatingRef } = useDismissable(onClose, { enabled: open })
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const atPoint = point !== null

  useEffect(() => {
    if (!open) return
    const floating = floatingRef.current
    const anchor = anchorRef.current
    if (floating && anchor) layerAnchors.set(floating, anchor)
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      const panel = floatingRef.current
      if (panel?.contains(target)) return
      // A button's own menu toggles on its button, so a press there is not
      // outside. A context menu's anchor is the card or column it was opened
      // on, often most of the screen: a press anywhere there closes it (MOP-46).
      if (!atPoint && anchorRef.current?.contains(target)) return
      if (panel && inLayerOpenedFrom(panel, target)) return
      closeRef.current()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      if (floating) layerAnchors.delete(floating)
    }
  }, [open, atPoint, anchorRef, floatingRef])

  // Closing removes the surface; its last frame fades out (exit.ts).
  useLayoutEffect(() => {
    if (!open) return
    const floating = floatingRef.current
    return () => playExit(floating)
  }, [open, floatingRef])

  const style = useAnchoredPosition(open, anchorRef, floatingRef, { placement, matchWidth, point })
  return { floatingRef, style }
}

/**
 * The window as overlays may use it: below the app's own title bar when it
 * draws one (`--title-bar-height`, set by useReserveTitleBar), the same line
 * every backdrop starts at.
 */
export function overlayViewport(): Viewport {
  const bar = parseFloat(document.documentElement.style.getPropertyValue('--title-bar-height'))
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    top: Number.isFinite(bar) ? bar : 0
  }
}

/**
 * How a layer waits for its first position: unseen and unclickable, but not
 * `visibility: hidden`, which would make it unfocusable. A menu focuses its
 * first item in an effect that runs before the positioned render reaches the
 * page, so a hidden menu never took focus from the keyboard (P9.2).
 */
const UNPLACED: CSSProperties = { opacity: 0, pointerEvents: 'none' }

/**
 * Fixed-position coordinates for `floatingRef` beside `anchorRef` (or at
 * `point`), kept in the viewport and refreshed on resize and scroll.
 */
export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  {
    placement = 'bottom-start',
    matchWidth = false,
    point = null
  }: Pick<AnchoredLayerOptions, 'placement' | 'matchWidth' | 'point'> = {}
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(UNPLACED)
  const pointX = point?.x
  const pointY = point?.y
  useLayoutEffect(() => {
    if (!open) {
      setStyle(UNPLACED)
      return
    }
    const update = () => {
      const floating = floatingRef.current
      const anchor = anchorRef.current
      if (!floating || (!anchor && pointX === undefined)) return
      const anchorRect =
        pointX !== undefined && pointY !== undefined
          ? { top: pointY, left: pointX, width: 0, height: 0 }
          : anchor!.getBoundingClientRect()
      const minWidth = matchWidth ? anchorRect.width : undefined
      const position = computePosition(
        anchorRect,
        {
          width: Math.max(floating.offsetWidth, minWidth ?? 0),
          height: floating.offsetHeight
        },
        pointX !== undefined ? 'bottom-start' : placement,
        overlayViewport()
      )
      const next = {
        top: position.top,
        left: position.left,
        minWidth,
        zIndex: layerAbove(anchor)
      }
      setStyle((current) =>
        current.top === next.top &&
        current.left === next.left &&
        current.minWidth === next.minWidth &&
        current.zIndex === next.zIndex
          ? current
          : next
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    // A layer whose content grows or shrinks, or whose anchor moves when the
    // page reflows under it, follows at once instead of staying where it
    // first opened until it is closed and reopened. Checked once a frame;
    // the style only changes when the position does.
    let frame = 0
    const follow = () => {
      update()
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      cancelAnimationFrame(frame)
    }
  }, [open, placement, matchWidth, pointX, pointY, anchorRef, floatingRef])

  return style
}
