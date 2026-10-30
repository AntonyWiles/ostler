import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  fitRect,
  nextZoomStep,
  screenToBoard,
  zoomAt,
  type Point,
  type Rect,
  type Size,
  type Viewport
} from '@shared/whiteboard/geometry'

export interface ViewportApi {
  viewport: Viewport
  /** The board element's size in screen pixels; 0 × 0 until it is laid out. */
  size: Size
  /** The board area shown, in board units (the scene's viewBox). */
  viewBox: Rect
  /** Moves what is shown by dx, dy screen pixels, as a drag would: the board follows the pointer. */
  panBy(dx: number, dy: number): void
  /** Zooms (clamped to 10%–400%) keeping the board point under `screenPoint` still; the centre when none. */
  zoomTo(zoom: number, screenPoint?: Point): void
  /** The next zoom step in (1) or out (-1), about the centre. */
  zoomStep(direction: 1 | -1): void
  /** Shows `rect` whole, centred, at no more than 100%. */
  fit(rect: Rect): void
  /** Sets the viewport outright. */
  setViewport(viewport: Viewport): void
  /** A client (window) point as a board point. */
  toBoard(clientPoint: Point): Point
}

/**
 * The whiteboard editor's view (plan `docs/plans/whiteboards/`, prompt 05,
 * D26): where the board is scrolled to and how far it is zoomed, over the
 * pure rules in `geometry.ts`, and the board element's size, kept by a
 * ResizeObserver where there is one (jsdom has none: the size stays 0 × 0).
 */
export function useViewport(element: RefObject<HTMLElement | null>): ViewportApi {
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  /** Event handlers read the newest values, ahead of a render. */
  const latest = useRef({ viewport, size })
  latest.current = { viewport: latest.current.viewport, size }

  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight }
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [element])

  const setViewport = useCallback((next: Viewport) => {
    latest.current = { ...latest.current, viewport: next }
    setViewportState(next)
  }, [])

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const { viewport: view } = latest.current
      setViewport({ x: view.x - dx / view.zoom, y: view.y - dy / view.zoom, zoom: view.zoom })
    },
    [setViewport]
  )

  const zoomTo = useCallback(
    (zoom: number, screenPoint?: Point) => {
      const { viewport: view, size: box } = latest.current
      const point = screenPoint ?? { x: box.width / 2, y: box.height / 2 }
      setViewport(zoomAt(view, point, zoom))
    },
    [setViewport]
  )

  const zoomStep = useCallback(
    (direction: 1 | -1) => zoomTo(nextZoomStep(latest.current.viewport.zoom, direction)),
    [zoomTo]
  )

  const fit = useCallback(
    (rect: Rect) => setViewport(fitRect(rect, latest.current.size)),
    [setViewport]
  )

  const toBoard = useCallback(
    (clientPoint: Point) => {
      const bounds = element.current?.getBoundingClientRect()
      const screen = {
        x: clientPoint.x - (bounds?.left ?? 0),
        y: clientPoint.y - (bounds?.top ?? 0)
      }
      return screenToBoard(latest.current.viewport, screen)
    },
    [element]
  )

  const viewBox: Rect = {
    x: viewport.x,
    y: viewport.y,
    width: Math.max(1, size.width) / viewport.zoom,
    height: Math.max(1, size.height) / viewport.zoom
  }
  return { viewport, size, viewBox, panBy, zoomTo, zoomStep, fit, setViewport, toBoard }
}
