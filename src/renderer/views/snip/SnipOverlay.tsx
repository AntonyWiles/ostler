import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { rectBetween, MIN_SNIP_SIZE, type SnipOverlayPicture, type SnipRect } from '@shared/snip'
import { formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import './SnipOverlay.css'

/**
 * Snip to task's overlay (N4.2a): one per display, frameless and on top,
 * on the snip route. It draws the frozen picture of its display, dimmed, and
 * the person drags a rectangle, its size shown as they drag. Esc or a right
 * click cancels; Enter takes the whole display under the pointer. Main does
 * the cropping: this page only says where.
 */
export function SnipOverlay({ displayId }: { displayId: number }) {
  const [picture, setPicture] = useState<SnipOverlayPicture | null>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<SnipRect | null>(null)
  const done = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI.getSnipPicture(displayId).then((result) => {
      if (cancelled) return
      if (result.ok) setPicture(result.value)
      else void window.ostlerAPI.cancelSnip()
    })
    return () => {
      cancelled = true
    }
  }, [displayId])

  useEffect(() => {
    rootRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (done.current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        done.current = true
        void window.ostlerAPI.selectSnip({ whole: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cancel = () => {
    done.current = true
    void window.ostlerAPI.cancelSnip()
  }

  const point = (event: ReactMouseEvent) => ({ x: event.clientX, y: event.clientY })

  const onMouseDown = (event: ReactMouseEvent) => {
    if (done.current) return
    if (event.button === 2) return cancel()
    if (event.button !== 0) return
    setStart(point(event))
    setRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 })
  }
  const onMouseMove = (event: ReactMouseEvent) => {
    if (start) setRect(rectBetween(start, point(event)))
  }
  const onMouseUp = (event: ReactMouseEvent) => {
    if (!start || event.button !== 0) return
    const chosen = rectBetween(start, point(event))
    setStart(null)
    if (chosen.width < MIN_SNIP_SIZE || chosen.height < MIN_SNIP_SIZE) {
      setRect(null)
      return
    }
    done.current = true
    void window.ostlerAPI.selectSnip({ displayId, rect: chosen }).then((result) => {
      // Too small for main after all: the overlay stays for another try.
      if (!result.ok || !result.value) {
        done.current = false
        setRect(null)
      }
    })
  }

  // Pixels, as the person will get them: the capture's own, not the window's.
  const scale = picture ? picture.width / Math.max(1, window.innerWidth) : 1
  return (
    <div
      ref={rootRef}
      className="snip-overlay"
      tabIndex={-1}
      role="application"
      aria-label={t('desktop:snip.overlayLabel')}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(event) => {
        event.preventDefault()
        if (!done.current) cancel()
      }}
    >
      {picture && (
        <img className="snip-overlay__picture" src={picture.dataUrl} alt="" draggable={false} />
      )}
      <div className={`snip-overlay__dim${rect ? ' snip-overlay__dim--cut' : ''}`} />
      {rect && rect.width > 0 && rect.height > 0 && (
        <div
          className="snip-overlay__selection"
          data-testid="snip-selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="snip-overlay__size">
            {t('desktop:snip.size', {
              width: formatNumber(Math.round(rect.width * scale)),
              height: formatNumber(Math.round(rect.height * scale))
            })}
          </span>
        </div>
      )}
      {!rect && <p className="snip-overlay__hint">{t('desktop:snip.hint')}</p>}
    </div>
  )
}
