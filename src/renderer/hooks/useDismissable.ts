import {
  createContext,
  createElement,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode
} from 'react'

type BackdropRef = React.RefObject<HTMLDivElement | null>

interface DismissableEntry {
  dismiss: () => void
  canDismiss: () => boolean
  element: () => HTMLElement | null
  /** This overlay's backdrop ref, which overlays opened inside it name as their parent. */
  ref: BackdropRef
  /** The overlay this one was opened inside, by React tree (see DismissableScope). */
  parent: BackdropRef | null
}

const ParentContext = createContext<BackdropRef | null>(null)

/**
 * Marks its children as opened inside the overlay whose backdrop ref is `of`.
 * Overlays portal to document.body, so the DOM no longer shows which one is
 * nested in which; React context does, through portals.
 */
export function DismissableScope({ of, children }: { of: BackdropRef; children?: ReactNode }) {
  return createElement(ParentContext.Provider, { value: of }, children)
}

/**
 * Every open dismissable, in registration order. Nested overlays (a report
 * modal opened from the work item drawer, a transcript opened from a session
 * review) all listen for Escape, so something has to decide which one it
 * closes. See topmostEntry for why registration order alone is not enough.
 */
const openStack: DismissableEntry[] = []

/**
 * The overlay Escape should close: the innermost one.
 *
 * Registration order does not answer this on its own. React runs child effects
 * before parent effects, so a modal nested inside another registers *first* --
 * the reverse of what "last registered is on top" would imply. Nesting is the
 * reliable signal: an overlay another one was opened inside (DismissableScope,
 * which works through portals) or whose element contains another overlay's
 * element is behind it. Among overlays that are not nested (siblings opened
 * independently), the most recently registered is on top.
 */
function topmostEntry(): DismissableEntry | undefined {
  // An overlay another open overlay was opened inside is behind it.
  const parents = new Set(openStack.map((entry) => entry.parent))
  const elements = openStack.map((entry) => entry.element())
  for (let i = openStack.length - 1; i >= 0; i--) {
    const candidate = elements[i]
    if (parents.has(openStack[i].ref)) continue
    if (!candidate) continue
    const containsAnother = elements.some(
      (other, j) => j !== i && other !== null && candidate.contains(other)
    )
    if (!containsAnother) return openStack[i]
  }
  return openStack.at(-1)
}

export interface DismissableOptions {
  /**
   * False while the overlay is not open, so its Escape handler is neither
   * registered nor counted as a candidate for the innermost overlay.
   */
  enabled?: boolean
  /**
   * False while the overlay is mid-flight (saving, generating) and must not go
   * away yet. It stays registered and still swallows Escape: letting the key
   * fall through would close the overlay *behind* the busy one.
   */
  canDismiss?: boolean
  /**
   * False for overlays holding unsaved edits, where a stray click on the
   * backdrop should not discard them. Escape still closes -- it is deliberate
   * in a way that a misplaced click is not.
   */
  closeOnBackdrop?: boolean
}

export interface DismissableBackdropProps {
  ref: React.RefObject<HTMLDivElement | null>
  onMouseDown: (event: React.MouseEvent) => void
}

/**
 * Escape-to-close, click-outside-to-close and focus restoration for an overlay.
 *
 * Ostler had fifteen modal backdrops and exactly one of them closed on Escape,
 * so every overlay was a mouse round-trip to a Cancel button that was sometimes
 * scrolled out of view. This centralises the behaviour rather than repeating a
 * keydown effect in fifteen components.
 *
 * Spread the returned props onto the backdrop element.
 */
export function useDismissable(
  onDismiss: () => void,
  { enabled = true, canDismiss = true, closeOnBackdrop = true }: DismissableOptions = {}
): DismissableBackdropProps {
  // Read through refs so a caller passing an inline arrow does not re-register
  // the listener (and reorder the stack) on every render.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const canDismissRef = useRef(canDismiss)
  canDismissRef.current = canDismiss
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const parent = useContext(ParentContext)

  // A layout effect, so Escape works from the moment the overlay is on the page:
  // a key pressed (or a test acting) before passive effects ran was lost.
  useLayoutEffect(() => {
    if (!enabled) return
    const entry: DismissableEntry = {
      dismiss: () => dismissRef.current(),
      canDismiss: () => canDismissRef.current,
      element: () => backdropRef.current,
      ref: backdropRef,
      parent
    }
    openStack.push(entry)

    const onKeyDown = (event: KeyboardEvent) => {
      // isComposing: Escape cancels an IME candidate window first, and that
      // press belongs to the IME rather than to this overlay.
      if (event.key !== 'Escape' || event.isComposing) return
      if (topmostEntry() !== entry) return
      // Swallowed either way: a busy overlay must not let Escape reach the one
      // stacked behind it.
      event.preventDefault()
      event.stopPropagation()
      if (entry.canDismiss()) entry.dismiss()
    }

    // Capture phase, so an overlay closes even when focus sits in a child that
    // stops propagation on its own keydown handling. Nothing runs before this,
    // which is also why there is no point checking event.defaultPrevented.
    window.addEventListener('keydown', onKeyDown, true)

    const restoreFocusTo = document.activeElement
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      const index = openStack.indexOf(entry)
      if (index >= 0) openStack.splice(index, 1)
      // Returning focus to whatever opened the overlay is what makes a
      // keyboard round-trip possible: open, act, Escape, carry on typing.
      if (restoreFocusTo instanceof HTMLElement && document.contains(restoreFocusTo)) {
        restoreFocusTo.focus()
      }
    }
  }, [enabled])

  return {
    ref: backdropRef,
    onMouseDown: (event: React.MouseEvent) => {
      if (!closeOnBackdrop || !canDismissRef.current) return
      // mousedown rather than click, and only when it both starts and stays on
      // the backdrop: a click handler fires when a text selection that began
      // inside the dialog happens to release out here, which should not close.
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      dismissRef.current()
    }
  }
}

/** Test seam: the stack is module state and must not leak between test cases. */
export function __resetDismissableStackForTests(): void {
  openStack.length = 0
}
