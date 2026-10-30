import type { ItemLinkInfo } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { taskStatusLabel } from '@shared/task-labels'
import {
  arrowHead,
  connectorGeometry,
  connectorLabelPoint,
  connectorPath,
  trimForHeads
} from '@shared/whiteboard/connectors'
import {
  FRAME_TITLE_BAND,
  LINK_BADGE_SIZE,
  linkBadgeRect,
  objectRect,
  type Point,
  type Rect
} from '@shared/whiteboard/geometry'
import { branchPath } from '@shared/whiteboard/mind-map'
import {
  STROKE_UNITS,
  TEXT_SIZE_UNITS,
  objectLinkTarget,
  type CardObject,
  type ConnectorObject,
  type FrameObject,
  type ImageObject,
  type MindmapObject,
  type NoteObject,
  type PenObject,
  type ShapeObject,
  type TextObject,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import { penWidth, strokePath } from '@shared/whiteboard/strokes'
import {
  NOTE_PADDING,
  SHAPE_PADDING,
  fitText,
  lineHeight,
  textBlockHeight,
  wrapText,
  type MeasureText
} from '@shared/whiteboard/text-layout'
import { ITEM_LINK_ICONS, itemKindLabel } from '../../ui/ItemLinkChip'
import { ExternalLink, ImageOff, type LucideIcon } from '../../ui/icons'
import { fillClass, textClass, textPaint } from './paint'

/**
 * One small drawing per object kind (docs/plans/whiteboards, prompt 04a),
 * used only by WhiteboardScene. Sizes are board units; every colour is a
 * WhiteboardScene.css class on a --whiteboard-* token, never a value, and
 * there is no <foreignObject>, so the same SVG can be exported as a picture.
 */

/** What every part may need besides its object. */
export interface PartContext {
  measure: MeasureText
  imageUrl: (imageItemId: string) => string | null
  links: ReadonlyMap<string, ItemLinkInfo> | undefined
  byId: ReadonlyMap<string, WhiteboardObjectInput>
}

const ROUNDED_CORNER = 12
const MINDMAP_STROKE = STROKE_UNITS.thin
const BRANCH_STROKE = STROKE_UNITS.medium
const FRAME_CORNER = 6
const BORDER = 1
const LABEL_PADDING = 4
const CARD_PADDING = 12
const CARD_ICON = 20
const CARD_GAP = 8
const STATUS_DOT = 4
const FRAME_TITLE_PADDING = 8
const MISSING_ICON = 48
const ELLIPSIS = '…'

// --- Text -------------------------------------------------------------------

/** The baseline of line `index` in a block whose top is `top`: each line centred in its line box. */
function baseline(top: number, index: number, fontSize: number): number {
  return top + index * lineHeight(fontSize) + lineHeight(fontSize) / 2 + fontSize * 0.35
}

function TextLines({
  lines,
  x,
  top,
  fontSize,
  anchor = 'start',
  className
}: {
  lines: readonly string[]
  x: number
  top: number
  fontSize: number
  anchor?: 'start' | 'middle' | 'end'
  className: string
}) {
  return (
    <text className={className} fontSize={fontSize} textAnchor={anchor}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} y={baseline(top, index, fontSize)}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

/** One line of text no wider than `width`: cut short with an ellipsis when it is wider. */
export function cutToFit(
  text: string,
  width: number,
  fontSize: number,
  measure: MeasureText
): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (measure(line, fontSize) <= width) return line
  let chars = Array.from(line)
  while (chars.length > 0 && measure(chars.join('') + ELLIPSIS, fontSize) > width) {
    chars = chars.slice(0, -1)
  }
  return chars.join('').trimEnd() + ELLIPSIS
}

/** Text fitted inside a box and centred both ways. */
function CentredText({
  text,
  box,
  fontSize,
  className,
  measure
}: {
  text: string
  box: Rect
  fontSize: number
  className: string
  measure: MeasureText
}) {
  if (text === '') return null
  const fitted = fitText(text, box, fontSize, SHAPE_PADDING, measure)
  const height = textBlockHeight(fitted.lines.length, fitted.fontSize)
  return (
    <TextLines
      lines={fitted.lines}
      x={box.x + box.width / 2}
      top={box.y + (box.height - height) / 2}
      fontSize={fitted.fontSize}
      anchor="middle"
      className={className}
    />
  )
}

/** A lucide icon drawn inside the SVG at a board position and size. */
function BoardIcon({
  icon: IconShape,
  at,
  size,
  className
}: {
  icon: LucideIcon
  at: Point
  size: number
  className: string
}) {
  return (
    <IconShape
      x={at.x}
      y={at.y}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  )
}

// --- The kinds --------------------------------------------------------------

/** A sticky note's turned-up corner: this many units, smaller on a small note. */
const NOTE_FOLD = 28
/** The sticky strip across a note's top, and how far its shadow falls. */
const NOTE_STRIP = 10
const NOTE_LIFT = 4

/**
 * A sticky note: a square of paper in its colour with a sticky strip across
 * the top, its bottom-right corner turned up and a soft shadow under it, so it
 * reads as a note stuck to the board rather than a box.
 */
export function NotePart({ object, measure }: { object: NoteObject; measure: MeasureText }) {
  const paint = textPaint(object)
  const { x, y, width, height, colour } = object
  const fold = Math.max(0, Math.min(NOTE_FOLD, width / 4, height / 4))
  const strip = Math.min(NOTE_STRIP, height / 8)
  const right = x + width
  const bottom = y + height
  const outline = `M ${x} ${y} H ${right} V ${bottom - fold} L ${right - fold} ${bottom} H ${x} Z`
  const fitted = fitText(
    object.text,
    object,
    TEXT_SIZE_UNITS[object.data.textSize],
    NOTE_PADDING,
    measure
  )
  return (
    <>
      <path
        d={outline}
        transform={`translate(${NOTE_LIFT / 2} ${NOTE_LIFT})`}
        className="wb-note-shadow"
      />
      <path d={outline} className={fillClass(paint.fill ?? 'paper')} data-note-body="" />
      <rect
        x={x}
        y={y}
        width={width}
        height={strip}
        className={`wb-fill-${colour} wb-note-strip`}
      />
      {fold > 0 && (
        <path
          d={`M ${right} ${bottom - fold} L ${right - fold} ${bottom - fold} L ${right - fold} ${bottom} Z`}
          className={`wb-fill-${colour} wb-note-fold`}
        />
      )}
      {object.text !== '' && (
        <TextLines
          lines={fitted.lines}
          x={x + NOTE_PADDING}
          top={y + NOTE_PADDING}
          fontSize={fitted.fontSize}
          className={textClass(paint.text)}
        />
      )}
    </>
  )
}

export function TextPart({ object, measure }: { object: TextObject; measure: MeasureText }) {
  const fontSize = TEXT_SIZE_UNITS[object.data.textSize]
  const { align } = object.data
  const x =
    align === 'middle'
      ? object.x + object.width / 2
      : align === 'end'
        ? object.x + object.width
        : object.x
  return (
    <TextLines
      lines={wrapText(object.text, object.width, fontSize, measure)}
      x={x}
      top={object.y}
      fontSize={fontSize}
      anchor={align}
      className={textClass(textPaint(object).text)}
    />
  )
}

function shapeOutline(object: ShapeObject, className: string, fill: string | undefined) {
  const { x, y, width, height } = object
  const common = { className, fill, strokeWidth: STROKE_UNITS[object.data.stroke] }
  switch (object.data.shape) {
    case 'rectangle':
      return <rect x={x} y={y} width={width} height={height} {...common} />
    case 'rounded': {
      const corner = Math.min(ROUNDED_CORNER, width / 2, height / 2)
      return <rect x={x} y={y} width={width} height={height} rx={corner} {...common} />
    }
    case 'ellipse':
      return (
        <ellipse
          cx={x + width / 2}
          cy={y + height / 2}
          rx={width / 2}
          ry={height / 2}
          {...common}
        />
      )
    case 'diamond':
      return (
        <polygon
          points={`${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`}
          {...common}
        />
      )
    case 'triangle':
      return (
        <polygon
          points={`${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`}
          {...common}
        />
      )
  }
}

export function ShapePart({ object, measure }: { object: ShapeObject; measure: MeasureText }) {
  const { colour, data } = object
  const paint = textPaint(object)
  const className = [`wb-stroke-${colour}`, paint.fill ? fillClass(paint.fill) : '']
    .filter(Boolean)
    .join(' ')
  return (
    <>
      {shapeOutline(object, className, data.fill === 'none' ? 'none' : undefined)}
      <CentredText
        text={object.text}
        box={object}
        fontSize={TEXT_SIZE_UNITS[data.textSize]}
        className={textClass(paint.text)}
        measure={measure}
      />
    </>
  )
}

/** The nearest point before `tip` (walking `line`) that is not the tip itself. */
function previousDistinct(tip: Point, line: readonly Point[]): Point {
  return line.find((point) => point.x !== tip.x || point.y !== tip.y) ?? tip
}

function headPoints(head: [Point, Point, Point]): string {
  return head.map((point) => `${point.x},${point.y}`).join(' ')
}

export function ConnectorPart({
  object,
  context
}: {
  object: ConnectorObject
  context: PartContext
}) {
  const { colour, data } = object
  const width = STROKE_UNITS[data.stroke]
  const { points } = connectorGeometry(object, context.byId)
  const startHead = data.startHead === 'arrow'
  const endHead = data.endHead === 'arrow'
  const line = trimForHeads(points, startHead, endHead, width)
  const last = points.length - 1
  const heads: [Point, Point, Point][] = []
  if (points.length >= 2 && endHead) {
    const tip = points[last]
    heads.push(arrowHead(tip, previousDistinct(tip, [...points.slice(0, last)].reverse()), width))
  }
  if (points.length >= 2 && startHead) {
    heads.push(arrowHead(points[0], previousDistinct(points[0], points.slice(1)), width))
  }

  let label = null
  if (object.text !== '') {
    const fontSize = TEXT_SIZE_UNITS.small
    const lines = object.text.split('\n')
    const textWidth = Math.max(...lines.map((text) => context.measure(text, fontSize)))
    const height = textBlockHeight(lines.length, fontSize)
    const at = connectorLabelPoint(points)
    const paint = textPaint(object)
    label = (
      <>
        <rect
          x={at.x - textWidth / 2 - LABEL_PADDING}
          y={at.y - height / 2 - LABEL_PADDING}
          width={textWidth + 2 * LABEL_PADDING}
          height={height + 2 * LABEL_PADDING}
          className={fillClass(paint.fill ?? 'paper')}
        />
        <TextLines
          lines={lines}
          x={at.x}
          top={at.y - height / 2}
          fontSize={fontSize}
          anchor="middle"
          className={textClass(paint.text)}
        />
      </>
    )
  }

  return (
    <>
      <path
        d={connectorPath(line)}
        className={[`wb-stroke-${colour}`, data.dashed ? 'wb-dashed' : '']
          .filter(Boolean)
          .join(' ')}
        fill="none"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {heads.map((head, index) => (
        <polygon key={index} points={headPoints(head)} className={`wb-fill-${colour}`} />
      ))}
      {label}
    </>
  )
}

export function PenPart({ object }: { object: PenObject }) {
  return (
    <path
      d={strokePath(object)}
      className={[`wb-stroke-${object.colour}`, object.data.marker ? 'wb-marker' : '']
        .filter(Boolean)
        .join(' ')}
      fill="none"
      strokeWidth={penWidth(object)}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

export function ImagePart({ object, context }: { object: ImageObject; context: PartContext }) {
  const { x, y, width, height } = object
  const url = object.data.imageItemId === null ? null : context.imageUrl(object.data.imageItemId)
  if (url !== null) {
    return (
      <image
        href={url}
        x={x}
        y={y}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid meet"
      />
    )
  }
  const size = Math.max(0, Math.min(MISSING_ICON, width / 2, height / 2))
  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className="wb-paper wb-stroke-grey wb-dashed"
        strokeWidth={BORDER}
        data-missing-picture=""
      />
      <BoardIcon
        icon={ImageOff}
        at={{ x: x + (width - size) / 2, y: y + (height - size) / 2 }}
        size={size}
        className="wb-icon-grey"
      />
    </>
  )
}

export function CardPart({ object, context }: { object: CardObject; context: PartContext }) {
  const { x, y, width, height } = object
  const target = objectLinkTarget(object)
  const info = object.link === null ? undefined : context.links?.get(object.link)
  const border = (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      className="wb-paper wb-stroke-grey"
      strokeWidth={BORDER}
    />
  )
  if (target === null) return border

  const titleSize = TEXT_SIZE_UNITS.medium
  const statusSize = TEXT_SIZE_UNITS.small
  const textX = x + CARD_PADDING + CARD_ICON + CARD_GAP
  const textWidth = Math.max(0, x + width - CARD_PADDING - textX)
  const gone = info !== undefined && !info.exists
  const title = gone
    ? t('common:itemLinks.deletedItem')
    : (info?.title ?? itemKindLabel(target.kind))
  const status = !gone && target.kind === 'task' ? info?.status : undefined
  const rowTop = y + CARD_PADDING
  return (
    <>
      {border}
      <BoardIcon
        icon={ITEM_LINK_ICONS[target.kind]}
        at={{ x: x + CARD_PADDING, y: rowTop + (lineHeight(titleSize) - CARD_ICON) / 2 }}
        size={CARD_ICON}
        className="wb-icon-ink"
      />
      <TextLines
        lines={[cutToFit(title, textWidth, titleSize, context.measure)]}
        x={textX}
        top={rowTop}
        fontSize={titleSize}
        className="wb-ink"
      />
      {status && (
        <>
          <circle
            cx={textX + STATUS_DOT}
            cy={rowTop + lineHeight(titleSize) + lineHeight(statusSize) / 2}
            r={STATUS_DOT}
            className={`wb-status-${status}`}
          />
          <TextLines
            lines={[
              cutToFit(
                taskStatusLabel(status),
                Math.max(0, textWidth - 2 * STATUS_DOT - CARD_GAP),
                statusSize,
                context.measure
              )
            ]}
            x={textX + 2 * STATUS_DOT + CARD_GAP}
            top={rowTop + lineHeight(titleSize)}
            fontSize={statusSize}
            className="wb-ink"
          />
        </>
      )}
    </>
  )
}

/**
 * A frame: a lightly tinted area with a border in its colour and its title on
 * a tab at the top-left, so it reads as a container that holds what is in it.
 */
export function FramePart({ object, measure }: { object: FrameObject; measure: MeasureText }) {
  const { x, y, width, height, colour } = object
  const fontSize = TEXT_SIZE_UNITS.small
  const title =
    object.text === ''
      ? ''
      : cutToFit(object.text, Math.max(0, width - 2 * FRAME_TITLE_PADDING), fontSize, measure)
  const tab = title === '' ? 0 : Math.min(width, measure(title, fontSize) + 2 * FRAME_TITLE_PADDING)
  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={FRAME_CORNER}
        className={`wb-fill-light-${colour} wb-frame-area wb-stroke-${colour}`}
        strokeWidth={BORDER * 2}
      />
      {tab > 0 && (
        <>
          <rect
            x={x}
            y={y}
            width={tab}
            height={FRAME_TITLE_BAND}
            rx={FRAME_CORNER}
            className={`wb-fill-light-${colour}`}
          />
          <TextLines
            lines={[title]}
            x={x + FRAME_TITLE_PADDING}
            top={y + (FRAME_TITLE_BAND - lineHeight(fontSize)) / 2}
            fontSize={fontSize}
            className={`${textClass(textPaint(object).text)} wb-frame-title`}
          />
        </>
      )}
    </>
  )
}

/**
 * A mind-map idea: a pill. The central idea is solid in its colour with light
 * words; every other idea is a light pill outlined in its colour, so a map
 * reads as ideas joined by branches, not as boxes.
 */
export function MindmapPart({ object, measure }: { object: MindmapObject; measure: MeasureText }) {
  const paint = textPaint(object)
  const central = object.data.parentId === null
  return (
    <>
      <rect
        x={object.x}
        y={object.y}
        width={object.width}
        height={object.height}
        rx={Math.min(object.width, object.height) / 2}
        className={`${fillClass(paint.fill ?? 'paper')} wb-stroke-${object.colour}`}
        strokeWidth={central ? 0 : MINDMAP_STROKE}
      />
      <CentredText
        text={object.text}
        box={object}
        fontSize={TEXT_SIZE_UNITS[object.data.textSize]}
        className={textClass(paint.text)}
        measure={measure}
      />
    </>
  )
}

/** Every mind-map branch: one per node whose parent is on the board, in the parent's colour. */
export function MindMapBranches({
  objects,
  byId
}: {
  objects: readonly WhiteboardObjectInput[]
  byId: ReadonlyMap<string, WhiteboardObjectInput>
}) {
  const branches = objects.flatMap((node) => {
    if (node.kind !== 'mindmap' || node.data.parentId === null) return []
    const parent = byId.get(node.data.parentId)
    if (!parent || parent.kind !== 'mindmap') return []
    return [
      <path
        key={node.id}
        d={branchPath(objectRect(parent), objectRect(node))}
        className={`wb-stroke-${parent.colour}`}
        fill="none"
        strokeWidth={BRANCH_STROKE}
        strokeLinecap="round"
        data-branch-of={node.id}
      />
    ]
  })
  return branches.length > 0 ? <g className="wb-branches">{branches}</g> : null
}

/** The link badge's icon, inside the badge's border. */
const BADGE_ICON = 14
/** A task link's status dot on the badge, 6 units across. */
const BADGE_STATUS_DOT = 3

/**
 * The link badge of a linked object that is not a card (prompt 12): the
 * linked kind's icon, or ExternalLink for a web address, in `linkBadgeRect`,
 * on paper with a grey border. A task link adds its status dot at the badge's
 * bottom-right; a link to a deleted item is drawn grey.
 */
export function LinkBadge({
  object,
  context
}: {
  object: WhiteboardObjectInput
  context: PartContext
}) {
  const box = linkBadgeRect(object)
  if (box === null || object.link === null) return null
  const target = objectLinkTarget(object)
  const info = target ? context.links?.get(object.link) : undefined
  const gone = info !== undefined && !info.exists
  const status = target?.kind === 'task' && !gone ? info?.status : undefined
  const inset = (LINK_BADGE_SIZE - BADGE_ICON) / 2
  return (
    <g data-link-badge="" className={gone ? 'wb-link-badge is-deleted' : 'wb-link-badge'}>
      <rect {...box} className="wb-paper wb-stroke-grey" strokeWidth={BORDER} />
      <BoardIcon
        icon={target ? ITEM_LINK_ICONS[target.kind] : ExternalLink}
        at={{ x: box.x + inset, y: box.y + inset }}
        size={BADGE_ICON}
        className={gone ? 'wb-icon-grey' : 'wb-icon-ink'}
      />
      {status && (
        <circle
          cx={box.x + box.width - BADGE_STATUS_DOT}
          cy={box.y + box.height - BADGE_STATUS_DOT}
          r={BADGE_STATUS_DOT}
          className={`wb-status-${status}`}
          data-status={status}
        />
      )}
    </g>
  )
}

/** The drawing of one object of any kind. */
export function ObjectPart({
  object,
  context
}: {
  object: WhiteboardObjectInput
  context: PartContext
}) {
  const { measure } = context
  switch (object.kind) {
    case 'note':
      return <NotePart object={object} measure={measure} />
    case 'text':
      return <TextPart object={object} measure={measure} />
    case 'shape':
      return <ShapePart object={object} measure={measure} />
    case 'connector':
      return <ConnectorPart object={object} context={context} />
    case 'pen':
      return <PenPart object={object} />
    case 'image':
      return <ImagePart object={object} context={context} />
    case 'card':
      return <CardPart object={object} context={context} />
    case 'frame':
      return <FramePart object={object} measure={measure} />
    case 'mindmap':
      return <MindmapPart object={object} measure={measure} />
  }
}
