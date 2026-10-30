import {
  CONNECTOR_ROUTES,
  SHAPE_FILLS,
  TEXT_ALIGNS,
  TEXT_SIZE_UNITS,
  WHITEBOARD_COLOURS,
  WHITEBOARD_SHAPES,
  WHITEBOARD_STROKES,
  WHITEBOARD_TEXT_SIZES,
  type WhiteboardObjectInput,
  type WhiteboardShape
} from '@shared/whiteboard/model'
import { autoTextHeight, type MeasureText } from '@shared/whiteboard/text-layout'
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Circle,
  CornerDownRight,
  Diamond,
  Minus,
  PaintBucket,
  RectangleHorizontal,
  Slash,
  Square,
  SquareDashed,
  Squircle,
  Triangle,
  type LucideIcon
} from '../../ui/icons'

/** Each shape's icon: in the shape picker and on the Shape tool's button (prompt 09). */
export const SHAPE_ICONS: Record<WhiteboardShape, LucideIcon> = {
  rectangle: RectangleHorizontal,
  rounded: Squircle,
  ellipse: Circle,
  diamond: Diamond,
  triangle: Triangle
}

/**
 * The style bar's controls (plan `docs/plans/whiteboards/`, prompt 06). Each
 * entry says which objects it applies to (by what their `data` holds), how to
 * read its value and how to write a new one. The bar shows an entry only when
 * it applies to every selected object. Prompt 09 added shape, fill and
 * stroke; prompt 10 added a connector's line, arrow heads and dashes.
 */
export interface StyleControl {
  id: string
  /**
   * Swatches for colours; a toggle button for an on/off setting (its options
   * are 'false' and 'true'); a segmented control for everything else.
   */
  view: 'swatches' | 'segmented' | 'toggle'
  /** Names the control group. */
  labelKey: string
  options: readonly string[]
  optionLabelKey(option: string): string
  /** An icon shown beside each option's name (the shape picker). */
  optionIcon?(option: string): LucideIcon
  /**
   * The control's own icon, for one whose options have none: the property
   * bar shows it with the chosen option's name (Text size: Medium).
   */
  icon?: LucideIcon
  applies(object: WhiteboardObjectInput): boolean
  read(object: WhiteboardObjectInput): string
  /** A copy with the value set; `measure` re-wraps text whose height follows its words. */
  write(object: WhiteboardObjectInput, value: string, measure: MeasureText): WhiteboardObjectInput
}

/** A text object grows to its words: its height after its size, width or words change. */
export function fitTextHeight(
  object: WhiteboardObjectInput,
  measure: MeasureText
): WhiteboardObjectInput {
  if (object.kind !== 'text') return object
  const height = autoTextHeight(
    object.text,
    object.width,
    TEXT_SIZE_UNITS[object.data.textSize],
    measure
  )
  return height === object.height ? object : { ...object, height }
}

function dataField(object: WhiteboardObjectInput, field: string): unknown {
  return (object.data as Record<string, unknown>)[field]
}

/** The arrow-head choices: where a connector has heads, mapped to `startHead` and `endHead`. */
export const ARROW_HEAD_CHOICES = ['none', 'end', 'start', 'both'] as const
type ArrowHeadChoice = (typeof ARROW_HEAD_CHOICES)[number]

function headsOf(object: WhiteboardObjectInput): ArrowHeadChoice {
  if (object.kind !== 'connector') return 'none'
  const start = object.data.startHead === 'arrow'
  const end = object.data.endHead === 'arrow'
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none'
}

const ALIGN_ICONS: Record<string, LucideIcon> = {
  start: AlignLeft,
  middle: AlignCenter,
  end: AlignRight
}
const FILL_ICONS: Record<string, LucideIcon> = {
  none: SquareDashed,
  light: Square,
  solid: PaintBucket
}
const HEAD_ICONS: Record<string, LucideIcon> = {
  none: Minus,
  end: ArrowRight,
  start: ArrowLeft,
  both: ArrowLeftRight
}

/**
 * Every style control, in the order the property bar shows them. The bar
 * always shows all of them in this order, so none moves when the selection
 * changes; one that does not apply is disabled.
 */
export const STYLE_CONTROLS: readonly StyleControl[] = [
  {
    id: 'colour',
    view: 'swatches',
    labelKey: 'library:whiteboard.style.colour',
    options: WHITEBOARD_COLOURS,
    optionLabelKey: (option) => `library:whiteboard.colours.${option}`,
    applies: () => true,
    read: (object) => object.colour,
    write: (object, value) =>
      ({ ...object, colour: value as WhiteboardObjectInput['colour'] }) as WhiteboardObjectInput
  },
  {
    id: 'textSize',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.textSize',
    options: WHITEBOARD_TEXT_SIZES,
    optionLabelKey: (option) => `library:whiteboard.textSizes.${option}`,
    icon: ALargeSmall,
    applies: (object) => typeof dataField(object, 'textSize') === 'string',
    read: (object) => String(dataField(object, 'textSize')),
    write: (object, value, measure) =>
      fitTextHeight(
        { ...object, data: { ...object.data, textSize: value } } as WhiteboardObjectInput,
        measure
      )
  },
  {
    id: 'align',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.align',
    options: TEXT_ALIGNS,
    optionLabelKey: (option) => `library:whiteboard.aligns.${option}`,
    optionIcon: (option) => ALIGN_ICONS[option] ?? AlignLeft,
    applies: (object) => object.kind === 'text',
    read: (object) => String(dataField(object, 'align')),
    write: (object, value) =>
      ({ ...object, data: { ...object.data, align: value } }) as WhiteboardObjectInput
  },
  {
    id: 'shape',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.shape',
    options: WHITEBOARD_SHAPES,
    optionLabelKey: (option) => `library:whiteboard.shapes.${option}`,
    optionIcon: (option) => SHAPE_ICONS[option as WhiteboardShape],
    applies: (object) => object.kind === 'shape',
    read: (object) => String(dataField(object, 'shape')),
    write: (object, value) =>
      ({ ...object, data: { ...object.data, shape: value } }) as WhiteboardObjectInput
  },
  {
    id: 'fill',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.fill',
    options: SHAPE_FILLS,
    optionLabelKey: (option) => `library:whiteboard.fills.${option}`,
    optionIcon: (option) => FILL_ICONS[option] ?? Square,
    applies: (object) => object.kind === 'shape',
    read: (object) => String(dataField(object, 'fill')),
    write: (object, value) =>
      ({ ...object, data: { ...object.data, fill: value } }) as WhiteboardObjectInput
  },
  {
    id: 'route',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.route',
    options: CONNECTOR_ROUTES,
    optionLabelKey: (option) => `library:whiteboard.routes.${option}`,
    optionIcon: (option) => (option === 'elbow' ? CornerDownRight : Slash),
    applies: (object) => object.kind === 'connector',
    read: (object) => String(dataField(object, 'route')),
    write: (object, value) =>
      ({ ...object, data: { ...object.data, route: value } }) as WhiteboardObjectInput
  },
  {
    id: 'heads',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.heads',
    options: ARROW_HEAD_CHOICES,
    optionLabelKey: (option) => `library:whiteboard.heads.${option}`,
    optionIcon: (option) => HEAD_ICONS[option] ?? Minus,
    applies: (object) => object.kind === 'connector',
    read: headsOf,
    write: (object, value) =>
      ({
        ...object,
        data: {
          ...object.data,
          startHead: value === 'start' || value === 'both' ? 'arrow' : 'none',
          endHead: value === 'end' || value === 'both' ? 'arrow' : 'none'
        }
      }) as WhiteboardObjectInput
  },
  {
    id: 'dashed',
    view: 'toggle',
    labelKey: 'library:whiteboard.style.dashed',
    options: ['false', 'true'],
    optionLabelKey: (option) => `library:whiteboard.toggle.${option === 'true' ? 'on' : 'off'}`,
    icon: SquareDashed,
    applies: (object) => object.kind === 'connector',
    read: (object) => String(dataField(object, 'dashed')),
    write: (object, value) =>
      ({ ...object, data: { ...object.data, dashed: value === 'true' } }) as WhiteboardObjectInput
  },
  {
    id: 'stroke',
    view: 'segmented',
    labelKey: 'library:whiteboard.style.stroke',
    options: WHITEBOARD_STROKES,
    optionLabelKey: (option) => `library:whiteboard.strokes.${option}`,
    icon: Minus,
    applies: (object) => typeof dataField(object, 'stroke') === 'string',
    read: (object) => String(dataField(object, 'stroke')),
    write: (object, value) =>
      ({ ...object, data: { ...object.data, stroke: value } }) as WhiteboardObjectInput
  }
]

/**
 * The controls that apply to every one of `objects` (none for an empty list),
 * limited to the ids in `only` when it is given.
 */
export function controlsFor(
  objects: readonly WhiteboardObjectInput[],
  only?: readonly string[]
): StyleControl[] {
  if (objects.length === 0) return []
  return STYLE_CONTROLS.filter(
    (control) =>
      (!only || only.includes(control.id)) && objects.every((object) => control.applies(object))
  )
}

/** True when `control` applies to every one of `objects` (false for none). */
export function controlApplies(
  control: StyleControl,
  objects: readonly WhiteboardObjectInput[],
  only?: readonly string[]
): boolean {
  return (
    objects.length > 0 &&
    (!only || only.includes(control.id)) &&
    objects.every((object) => control.applies(object))
  )
}

/** The value every object shares, or null when they differ. */
export function sharedValue(
  control: StyleControl,
  objects: readonly WhiteboardObjectInput[]
): string | null {
  const values = new Set(objects.map((object) => control.read(object)))
  return values.size === 1 ? [...values][0] : null
}
