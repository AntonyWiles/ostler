import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from 'react'
import { t } from '@shared/i18n'

const STORAGE_KEY = 'ostler.library-detail-width'
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 440
/** Room always left for the list beside the details. */
const LIST_MIN_WIDTH = 384
const KEYBOARD_STEP = 32

function readWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Storage is a convenience: details that forget their width still work.
  }
}

/**
 * The width of the Library's details, which the person drags wider (into the
 * list) or narrower; remembered across projects and restarts. The grid keeps
 * the list at least LIST_MIN_WIDTH wide whatever is stored.
 */
export function useLibraryDetailWidth(rootRef: RefObject<HTMLElement | null>) {
  const [width, setWidthState] = useState(readWidth)
  // For assistive tech; brought up to date whenever the width changes.
  const [shownMax, setShownMax] = useState(() =>
    Math.max(MIN_WIDTH, window.innerWidth - LIST_MIN_WIDTH)
  )
  const maxWidth = useCallback(
    () => Math.max(MIN_WIDTH, (rootRef.current?.clientWidth || window.innerWidth) - LIST_MIN_WIDTH),
    [rootRef]
  )
  const setWidth = useCallback(
    (next: number) => {
      const max = maxWidth()
      const clamped = Math.round(Math.min(Math.max(next, MIN_WIDTH), max))
      setShownMax(max)
      setWidthState(clamped)
      saveWidth(clamped)
    },
    [maxWidth]
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The handle is on the left edge: Left widens, Right narrows.
    const delta = { ArrowLeft: KEYBOARD_STEP, ArrowRight: -KEYBOARD_STEP }[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      setWidth(Math.min(width, maxWidth()) + delta)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWidth(MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(maxWidth())
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) => {
      const right = rootRef.current?.getBoundingClientRect().right ?? window.innerWidth
      setWidth(right - moveEvent.clientX)
    }
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  return {
    /** On the Library's grid, which sizes the details column from it. */
    style: { '--library-detail-width': `${width}px` } as CSSProperties,
    handle: (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('library:libraryDetail.resizeDetails')}
        aria-valuenow={Math.min(width, shownMax)}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={shownMax}
        tabIndex={0}
        className="ostler-library-detail-resize"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      >
        <span className="ostler-library-detail-grip" aria-hidden="true" />
      </div>
    )
  }
}
