import { t } from '@shared/i18n'
import { refreshConnectors } from '@shared/whiteboard/connectors'
import { objectRect, unionRect } from '@shared/whiteboard/geometry'
import { addMindMapChild, newMindMapRoot, relayoutMindMaps } from '@shared/whiteboard/mind-map'
import {
  TEXT_SIZE_UNITS,
  WHITEBOARD_GRID,
  type ConnectorObject,
  type FrameObject,
  type TextObject,
  type WhiteboardColour,
  type WhiteboardObjectInput,
  type WhiteboardTextSize
} from '@shared/whiteboard/model'
import { autoTextHeight, estimateTextWidth, type MeasureText } from '@shared/whiteboard/text-layout'

/**
 * The templates New whiteboard offers (plan `docs/plans/whiteboards/`, D19).
 * Each is built in code when the board is made, from translated strings, so
 * its words are in the person's language and nothing extra is stored.
 */
export const WHITEBOARD_TEMPLATES = [
  'blank',
  'brainstorm',
  'retrospective',
  'kick-off',
  'journey'
] as const
export type WhiteboardTemplate = (typeof WHITEBOARD_TEMPLATES)[number]

export interface TemplateOptions {
  /** The project's name: Brainstorm's central idea and the kick-off's title. */
  projectName: string
  /** Makes each object's id (the dialog passes `crypto.randomUUID`, tests a counter). */
  newId: () => string
  /** Sizes titles and mind-map nodes to their words; the editor's measure in the app. */
  measure?: MeasureText
}

/** The space between a template's frames, and below its title. */
const GAP = 40
const RETRO_FRAME = { width: 400, height: 560 }
const KICK_OFF_FRAME = { width: 400, height: 300 }
const JOURNEY_FRAME = { width: 280, height: 400 }
const JOURNEY_GAP = 80
/** The column of row labels left of the journey map's frames. */
const JOURNEY_LABEL_WIDTH = 120

/** Up to the next grid line. */
const onGrid = (value: number) => Math.ceil(value / WHITEBOARD_GRID) * WHITEBOARD_GRID

/** A template's words, in the language shown. */
function word(template: WhiteboardTemplate, part: string, values?: Record<string, unknown>) {
  return t(`library:whiteboard.templates.${template}.${part}`, values)
}

/** Builds one template's objects: ids from `newId`, z in the order they are made. */
class Builder {
  readonly objects: WhiteboardObjectInput[] = []
  private z = 0

  constructor(
    private readonly newId: () => string,
    readonly measure: MeasureText
  ) {}

  next() {
    this.z += 1
    return { id: this.newId(), z: this.z }
  }

  add<T extends WhiteboardObjectInput>(object: T): T {
    this.objects.push(object)
    return object
  }

  /** A text object as tall as its words at `width`, on the grid. */
  text(
    text: string,
    at: { x: number; y: number; width: number },
    textSize: WhiteboardTextSize
  ): TextObject {
    const height = onGrid(autoTextHeight(text, at.width, TEXT_SIZE_UNITS[textSize], this.measure))
    return this.add({
      ...this.next(),
      kind: 'text',
      ...at,
      height,
      colour: 'black',
      text,
      link: null,
      groupId: null,
      data: { textSize, align: 'start' }
    })
  }

  frame(
    text: string,
    rect: { x: number; y: number; width: number; height: number },
    colour: WhiteboardColour = 'grey'
  ): FrameObject {
    return this.add({
      ...this.next(),
      kind: 'frame',
      ...rect,
      colour,
      text,
      link: null,
      groupId: null,
      data: {}
    })
  }

  /** A straight arrow from one object to another, both ends stuck; `refreshConnectors` places them. */
  arrow(from: WhiteboardObjectInput, to: WhiteboardObjectInput): ConnectorObject {
    const start = { x: from.x + from.width, y: from.y + from.height / 2 }
    const end = { x: to.x, y: to.y + to.height / 2 }
    return this.add({
      ...this.next(),
      kind: 'connector',
      x: start.x,
      y: Math.min(start.y, end.y),
      width: end.x - start.x,
      height: Math.abs(end.y - start.y),
      colour: 'black',
      text: '',
      link: null,
      groupId: null,
      data: {
        from: { objectId: from.id, ...start },
        to: { objectId: to.id, ...end },
        startHead: 'none',
        endHead: 'arrow',
        route: 'straight',
        stroke: 'medium',
        dashed: false
      }
    })
  }

  /** Replaces objects by id with the changed copies. */
  replace(changed: readonly WhiteboardObjectInput[]) {
    const byId = new Map(changed.map((object) => [object.id, object]))
    for (let index = 0; index < this.objects.length; index++) {
      const update = byId.get(this.objects[index].id)
      if (update) this.objects[index] = update
    }
  }
}

/** A mind map around the project's name with three ideas, laid out like the editor's. */
function brainstorm(build: Builder, projectName: string) {
  const name = projectName.trim() || word('brainstorm', 'mainIdea')
  const root = build.add(newMindMapRoot({ ...build.next(), x: 0, y: 0, text: name }))
  for (let number = 1; number <= 3; number++) {
    const child = addMindMapChild(build.objects, root.id, build.next())
    build.add({ ...child, text: word('brainstorm', 'idea', { number }) })
  }
  build.replace(relayoutMindMaps(build.objects, [root.id], build.measure))
  // The ideas stack around the central idea; move the map down so it starts at 0.
  const top = unionRect(build.objects.map(objectRect))?.y ?? 0
  const down = top < 0 ? onGrid(-top) : 0
  build.replace(build.objects.map((object) => ({ ...object, y: object.y + down })))
}

/** A title and three coloured columns. */
function retrospective(build: Builder) {
  const columns: [string, WhiteboardColour][] = [
    [word('retrospective', 'wentWell'), 'green'],
    [word('retrospective', 'couldBeBetter'), 'orange'],
    [word('retrospective', 'tryNext'), 'blue']
  ]
  const width = columns.length * RETRO_FRAME.width + (columns.length - 1) * GAP
  const title = build.text(word('retrospective', 'title'), { x: 0, y: 0, width }, 'huge')
  const top = title.height + GAP
  columns.forEach(([text, colour], index) => {
    build.frame(text, { x: index * (RETRO_FRAME.width + GAP), y: top, ...RETRO_FRAME }, colour)
  })
}

/** A title with the project's name and six frames in two rows of three. */
function kickOff(build: Builder, projectName: string) {
  const name = projectName.trim()
  const parts = ['goal', 'audience', 'inScope', 'outOfScope', 'risks', 'nextSteps']
  const width = 3 * KICK_OFF_FRAME.width + 2 * GAP
  const title = build.text(
    name ? word('kick-off', 'title', { name }) : word('kick-off', 'name'),
    { x: 0, y: 0, width },
    'huge'
  )
  const top = title.height + GAP
  parts.forEach((part, index) => {
    const column = index % 3
    const row = Math.floor(index / 3)
    build.frame(word('kick-off', part), {
      x: column * (KICK_OFF_FRAME.width + GAP),
      y: top + row * (KICK_OFF_FRAME.height + GAP),
      ...KICK_OFF_FRAME
    })
  })
}

/** A title, five stages joined by arrows, and three rows named down the left. */
function journey(build: Builder) {
  const stages = ['discover', 'choose', 'start', 'use', 'share']
  const left = JOURNEY_LABEL_WIDTH + GAP
  const width = left + stages.length * JOURNEY_FRAME.width + (stages.length - 1) * JOURNEY_GAP
  const title = build.text(word('journey', 'title'), { x: 0, y: 0, width }, 'huge')
  const top = title.height + GAP
  const frames = stages.map((stage, index) =>
    build.frame(word('journey', stage), {
      x: left + index * (JOURNEY_FRAME.width + JOURNEY_GAP),
      y: top,
      ...JOURNEY_FRAME
    })
  )
  for (let index = 1; index < frames.length; index++) build.arrow(frames[index - 1], frames[index])
  build.replace(refreshConnectors(build.objects))
  const third = JOURNEY_FRAME.height / 3
  const font = TEXT_SIZE_UNITS.small
  ;['doing', 'thinking', 'feeling'].forEach((row, index) => {
    const text = word('journey', row)
    const height = onGrid(autoTextHeight(text, JOURNEY_LABEL_WIDTH, font, build.measure))
    // Centred on its third of the frames, on the grid.
    const middle = top + third * (index + 0.5) - height / 2
    const y = Math.round(middle / WHITEBOARD_GRID) * WHITEBOARD_GRID
    build.text(text, { x: 0, y, width: JOURNEY_LABEL_WIDTH }, 'small')
  })
}

/**
 * The objects a new board made from `template` starts with, laid out from
 * (0, 0), in the language shown. Blank has none.
 */
export function buildTemplate(
  template: WhiteboardTemplate,
  { projectName, newId, measure = estimateTextWidth }: TemplateOptions
): WhiteboardObjectInput[] {
  const build = new Builder(newId, measure)
  switch (template) {
    case 'blank':
      break
    case 'brainstorm':
      brainstorm(build, projectName)
      break
    case 'retrospective':
      retrospective(build)
      break
    case 'kick-off':
      kickOff(build, projectName)
      break
    case 'journey':
      journey(build)
      break
  }
  return build.objects
}
