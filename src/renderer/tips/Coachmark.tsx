import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Portal } from '../ui/Portal'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { ArrowLeft, ArrowRight, Check, Icon, Lightbulb, X } from '../ui/icons'
import { cx } from '../ui/cx'
import { t } from '@shared/i18n'
import { layerOf, overlayViewport } from '../ui/overlay/layer'
import { placeTip, type TipPosition, type TipSide } from './placement'
import type { TipPointer } from './catalog'
import { TipHighlights, type HighlightMark } from './TipHighlights'
import { applyMarks, clearMarks, shapeOf, type TipMark } from './outline'
import './Coachmark.css'

export interface CoachmarkStepper {
  index: number
  count: number
  onBack: () => void
  onNext: () => void
  onGoTo: (index: number) => void
}

export interface CoachmarkProps {
  /** The element pointed at. */
  target: Element
  side: TipSide
  /** A short word above the title: "Tip", "Tour". */
  eyebrow: string
  title: string
  body: string
  /** Close (X). */
  onClose: () => void
  closeLabel: string
  /** Steps of a walkthrough: dots, "2 of 7", Back and Next. */
  stepper?: CoachmarkStepper
  /** The buttons at the bottom, when it is not a walkthrough. */
  actions?: ReactNode
  /** Links under the buttons, such as "Don't show tips". */
  footer?: ReactNode
  /** Take focus on show: only when the person asked for it (they started the walkthrough). */
  takeFocus?: boolean
  /** Highlights on exactly what to click or drag (`TipPointer`). */
  pointers?: readonly TipPointer[]
  /** False: no outlines, on the target or on what the pointers name; their labels stay. */
  outline?: false
}

function rectOf(element: Element) {
  const box = element.getBoundingClientRect()
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

function sameRect(a: ReturnType<typeof rectOf> | null, b: ReturnType<typeof rectOf>) {
  return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/** How often the tip checks whether its target moved (a drawer sliding in, a list loading). */
const FOLLOW_MS = 200

/** More steps than this, and the dots get a row of their own above Back and Next. */
const LONG_TOUR = 8

/**
 * The z-index to draw a highlight at: the layer its control is in, or just
 * under menus for the page itself. A menu or dialog opened over the control
 * then covers its highlight too, rather than the highlight floating on top.
 */
function layerFor(element: Element): string {
  const z = layerOf(element)
  return z === undefined ? 'calc(var(--z-dropdown) - 1)' : String(z)
}

/**
 * Whether something else sits over the middle of the element: a menu, a
 * dialog, a popover. The tip's own panel does not count (its highlights take
 * no clicks, so the hit test passes through them).
 */
function isCovered(element: Element): boolean {
  const box = element.getBoundingClientRect()
  if (box.width === 0 || box.height === 0 || !document.elementsFromPoint) return false
  const hits = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  const top = hits.find((hit) => !hit.closest('.ostler-coachmark'))
  return !!top && top !== element && !element.contains(top) && !top.contains(element)
}

/**
 * What each pointer marks now: its control (and for a drag, where it can go),
 * each added to `marked` with how it is marked, and the label and ghost to
 * draw beside it. One whose control is not on the page, or is hidden under a
 * menu or dialog, is left out.
 */
function measurePointers(
  pointers: readonly TipPointer[],
  marked: Map<Element, TipMark>
): HighlightMark[] {
  const marks: HighlightMark[] = []
  for (const pointer of pointers) {
    const from = pointer.find()
    if (!from || isCovered(from)) continue
    const to = pointer.to ? pointer.to(from) : null
    // A drag with nowhere to go says nothing: leave it out rather than mark nothing.
    if (pointer.to && !to) continue
    const fromShape = shapeOf(from)
    const toShape = to ? shapeOf(to) : null
    marked.set(fromShape, 'click')
    if (toShape) marked.set(toShape, 'drop')
    marks.push({
      from: rectOf(fromShape),
      to: toShape ? rectOf(toShape) : null,
      label: pointer.label(),
      layer: layerFor(from)
    })
  }
  return marks
}

/**
 * A small note beside the element it explains, with an arrow pointing at it;
 * that element's own border turns the accent colour, and so does that of what
 * to click or drag, which also gets a label (`TipHighlights`). Not modal: the window stays usable, nothing is
 * dimmed, and it never takes focus unless the person started a walkthrough.
 * It is a labelled landmark, so a screen reader can find it, and Escape (from
 * inside) or the X closes it.
 */
export function Coachmark({
  target,
  side,
  eyebrow,
  title,
  body,
  onClose,
  closeLabel,
  stepper,
  actions,
  footer,
  takeFocus = false,
  pointers,
  outline
}: CoachmarkProps) {
  const titleId = useId()
  const bodyId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState(() => rectOf(target))
  const [position, setPosition] = useState<TipPosition | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [marks, setMarks] = useState<HighlightMark[]>([])
  const [targetLayer, setTargetLayer] = useState(() => layerFor(target))

  // Follow the target: scrolling, resizing and anything that moves it. What the
  // tip is about, and what to click or drag, are marked by their own borders.
  useEffect(() => {
    let last: ReturnType<typeof rectOf> | null = null
    let lastMarks = ''
    let marked = new Map<Element, TipMark>()
    const measure = () => {
      const wanted = new Map<Element, TipMark>()
      if (target.isConnected) wanted.set(shapeOf(target), 'target')
      if (pointers) {
        const nextMarks = measurePointers(pointers, wanted)
        const key = JSON.stringify(nextMarks)
        if (key !== lastMarks) {
          lastMarks = key
          setMarks(nextMarks)
        }
      }
      marked = applyMarks(marked, outline === false ? new Map() : wanted)
      if (!target.isConnected) return
      setTargetLayer(layerFor(target))
      const next = rectOf(target)
      if (sameRect(last, next)) return
      last = next
      setAnchor(next)
    }
    measure()
    const timer = window.setInterval(measure, FOLLOW_MS)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      clearMarks(marked)
    }
  }, [target, pointers, outline])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const measured = { width: panel.offsetWidth, height: panel.offsetHeight }
    setSize(measured)
    setPosition(placeTip(anchor, measured, side, overlayViewport()))
  }, [anchor, side, title, body, stepper?.index])

  // Bring the target into view when it is off screen.
  useEffect(() => {
    const box = target.getBoundingClientRect()
    if (
      box.bottom < 0 ||
      box.top > window.innerHeight ||
      box.right < 0 ||
      box.left > window.innerWidth
    )
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [target])

  // Once placed: a hidden panel cannot take focus.
  const placed = position !== null
  useEffect(() => {
    if (takeFocus && placed) (primaryRef.current ?? panelRef.current)?.focus()
  }, [takeFocus, placed, stepper?.index])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (!stepper || (event.target as HTMLElement).closest('input, textarea')) return
      if (event.key === 'ArrowRight' && stepper.index < stepper.count - 1) {
        event.preventDefault()
        stepper.onNext()
      } else if (event.key === 'ArrowLeft' && stepper.index > 0) {
        event.preventDefault()
        stepper.onBack()
      }
    },
    [onClose, stepper]
  )

  const style: CSSProperties = position
    ? {
        top: position.top,
        left: position.left,
        // The card sits in its target's layer: a menu or dialog opened later covers it.
        zIndex: targetLayer,
        ['--tip-arrow' as string]: `${position.arrow}px`
      }
    : { top: 0, left: 0, visibility: 'hidden' }
  const last = stepper ? stepper.index === stepper.count - 1 : false

  return (
    <Portal>
      {marks.length > 0 && position && (
        <TipHighlights
          tip={{ top: position.top, left: position.left, width: size.width, height: size.height }}
          marks={marks}
        />
      )}
      <div
        ref={panelRef}
        role="region"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={cx('ostler-coachmark', position && `ostler-coachmark--${position.side}`)}
        style={style}
        onKeyDown={onKeyDown}
        data-testid="coachmark"
      >
        <span className="ostler-coachmark__arrow" aria-hidden="true" />
        <div className="ostler-coachmark__head">
          <span className="ostler-coachmark__eyebrow">
            <Icon icon={Lightbulb} className="ostler-coachmark__eyebrow-icon" />
            {eyebrow}
            {stepper && (
              <span className="ostler-coachmark__count">
                {t('onboarding:tips.stepOf', { step: stepper.index + 1, count: stepper.count })}
              </span>
            )}
          </span>
          <IconButton icon={X} size="sm" label={closeLabel} onClick={onClose} />
        </div>
        <h2 id={titleId} className="ostler-coachmark__title">
          {title}
        </h2>
        <p id={bodyId} className="ostler-coachmark__body">
          {body}
        </p>
        {stepper ? (
          <div
            className={cx(
              'ostler-coachmark__stepper',
              stepper.count > LONG_TOUR && 'ostler-coachmark__stepper--long'
            )}
          >
            <div
              className="ostler-coachmark__dots"
              role="group"
              aria-label={t('onboarding:tips.steps')}
            >
              {Array.from({ length: stepper.count }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  className={cx('ostler-coachmark__dot', index === stepper.index && 'is-current')}
                  aria-label={t('onboarding:tips.goToStep', { step: index + 1 })}
                  aria-current={index === stepper.index ? 'step' : undefined}
                  onClick={() => stepper.onGoTo(index)}
                />
              ))}
            </div>
            <div className="ostler-coachmark__nav">
              {stepper.index > 0 && (
                <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={stepper.onBack}>
                  {t('onboarding:tips.back')}
                </Button>
              )}
              <Button
                ref={primaryRef}
                size="sm"
                variant="primary"
                iconEnd={last ? Check : ArrowRight}
                onClick={stepper.onNext}
              >
                {last ? t('onboarding:tips.done') : t('onboarding:tips.next')}
              </Button>
            </div>
          </div>
        ) : (
          actions && <div className="ostler-coachmark__actions">{actions}</div>
        )}
        {footer && <div className="ostler-coachmark__footer">{footer}</div>}
      </div>
    </Portal>
  )
}
