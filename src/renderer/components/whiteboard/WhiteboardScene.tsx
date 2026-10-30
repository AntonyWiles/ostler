import { useId, useMemo, type ReactNode, type SVGProps } from 'react'
import type { ItemLinkInfo } from '@shared/ostler-api'
import { drawOrder, type Rect } from '@shared/whiteboard/geometry'
import { WHITEBOARD_GRID, objectsById, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import type { MeasureText } from '@shared/whiteboard/text-layout'
import { appFontFamily } from '../markup/draw'
import { canvasMeasure } from './measure'
import { LinkBadge, MindMapBranches, ObjectPart, type PartContext } from './scene-parts'
import './WhiteboardScene.css'

export interface WhiteboardSceneProps {
  objects: readonly WhiteboardObjectInput[]
  /** The board area shown, in board units (the SVG viewBox). */
  viewBox: Rect
  width?: number | string
  height?: number | string
  /** Where each picture is drawn from: an ostler-library: URL in the app, a data: URL in exports; null when missing. */
  imageUrl: (imageItemId: string) => string | null
  /** Live title and task status for linked items, keyed by link URL (from resolveItemLinks). */
  links?: ReadonlyMap<string, ItemLinkInfo>
  measure?: MeasureText
  /** Extra attributes for each object's <g> (the editor makes objects focusable). */
  objectProps?: (object: WhiteboardObjectInput) => SVGProps<SVGGElement>
  /** Objects not drawn (one being edited in a text box over the board). */
  hiddenIds?: ReadonlySet<string>
  grid?: boolean
  /** Drawn last, in board units (the editor's selection and handles). */
  overlay?: ReactNode
  /** When given, the SVG is role="img" with this name; otherwise it is aria-hidden. */
  label?: string
  /**
   * The editor's objects are focusable controls (prompt 05): the SVG is then
   * neither an image nor hidden (role="none"), and the host names the board.
   */
  interactive?: boolean
  className?: string
}

const GRID_DOT = 1

/**
 * The one drawing of a whiteboard (docs/plans/whiteboards, prompt 04a): the
 * editor, the Library preview, the print page and export all draw a board
 * with it, so what is seen is what is exported. Objects are drawn in
 * `drawOrder` (frames first), with every mind-map branch after the frames and
 * before everything else. Colours are classes on --whiteboard-* tokens
 * (WhiteboardScene.css); there is no <foreignObject>.
 */
export function WhiteboardScene({
  objects,
  viewBox,
  width,
  height,
  imageUrl,
  links,
  measure,
  objectProps,
  hiddenIds,
  grid = false,
  overlay,
  label,
  interactive = false,
  className
}: WhiteboardSceneProps) {
  const patternId = `wb-grid-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const fontFamily = useMemo(() => appFontFamily(), [])
  const measureText = useMemo(() => measure ?? canvasMeasure(fontFamily), [measure, fontFamily])
  const byId = useMemo(() => objectsById(objects), [objects])
  const ordered = useMemo(() => drawOrder(objects), [objects])
  const context: PartContext = { measure: measureText, imageUrl, links, byId }

  const frameCount = ordered.findIndex((object) => object.kind !== 'frame')
  const frames = frameCount === -1 ? ordered : ordered.slice(0, frameCount)
  const others = frameCount === -1 ? [] : ordered.slice(frameCount)
  const draw = (object: WhiteboardObjectInput) =>
    hiddenIds?.has(object.id) ? null : (
      <g key={object.id} {...objectProps?.(object)} data-object-id={object.id}>
        <ObjectPart object={object} context={context} />
        <LinkBadge object={object} context={context} />
      </g>
    )

  const view = { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      width={width}
      height={height}
      className={['wb-scene', className].filter(Boolean).join(' ')}
      fontFamily={fontFamily}
      {...(interactive
        ? { role: 'none' }
        : label
          ? { role: 'img', 'aria-label': label }
          : { 'aria-hidden': true })}
    >
      {grid && (
        <defs>
          <pattern
            id={patternId}
            x={-WHITEBOARD_GRID / 2}
            y={-WHITEBOARD_GRID / 2}
            width={WHITEBOARD_GRID}
            height={WHITEBOARD_GRID}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={WHITEBOARD_GRID / 2}
              cy={WHITEBOARD_GRID / 2}
              r={GRID_DOT}
              className="wb-grid"
            />
          </pattern>
        </defs>
      )}
      <rect {...view} className="wb-paper" />
      {grid && <rect {...view} fill={`url(#${patternId})`} data-grid="" />}
      {frames.map(draw)}
      <MindMapBranches objects={ordered} byId={byId} />
      {others.map(draw)}
      {overlay}
    </svg>
  )
}
