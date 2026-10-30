import { strToU8, zipSync } from 'fflate'
import {
  compareIsoDates,
  formatIsoDate,
  isIsoDate,
  isoDaysBetween,
  isoWeekday,
  shiftIsoDate
} from '../dates'
import type { TimelineRow } from '../planning/timeline-rows'
import { timelineBarSpan } from '../planning/timeline'
import { t } from '../i18n'

/*
 * The Timeline as PowerPoint slides (N7.6, N54): the rows the Timeline draws,
 * for a date range, as real shapes the person can move, recolour and retype
 * (a rounded rectangle per bar, a diamond per milestone, a text box per
 * label, a line for today), never a picture. The one writer: the Timeline's
 * "Export to PowerPoint slide…" and `GET /export?format=pptx` both call it.
 *
 * No dependency (N4): the smallest set of Office Open XML parts PowerPoint
 * opens without a repair, written as text and zipped with fflate. Positions
 * are whole EMUs (914,400 per inch) on a 16:9 slide.
 */

export type TimelineSlideZoom = 'week' | 'month' | 'quarter'

export interface TimelineSlidesInput {
  projectName: string
  /** The project's colour, `#rrggbb`; bars use it. */
  projectColor: string
  /** The Timeline's rows (`buildTimelineRows`), in its grouping and filter. */
  rows: readonly TimelineRow[]
  /** The first and last day shown, `YYYY-MM-DD`, inclusive. */
  from: string
  to: string
  /** Week zoom draws a week axis; month and quarter draw months. */
  zoom: TimelineSlideZoom
  /** `YYYY-MM-DD`, for today's line. */
  today: string
}

export const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** The longest range a slide draws, in days. */
export const MAX_SLIDE_RANGE_DAYS = 3 * 366
/** Rows on one slide; more go on further slides. */
export const ROWS_PER_SLIDE = 18
/** A task label longer than this is cut with an ellipsis (the full title stays in its alt text). */
export const LABEL_MAX_CHARS = 34

const EMU_PER_INCH = 914400
export const SLIDE_WIDTH = 12192000
export const SLIDE_HEIGHT = 6858000
const MARGIN = EMU_PER_INCH / 2
const TITLE_Y = 228600
const TITLE_HEIGHT = 548640
const AXIS_Y = 868680
const AXIS_HEIGHT = 274320
export const ROWS_Y = AXIS_Y + AXIS_HEIGHT + 45720
export const ROW_HEIGHT = Math.floor((SLIDE_HEIGHT - MARGIN - ROWS_Y) / ROWS_PER_SLIDE)
const LABEL_WIDTH = 3 * EMU_PER_INCH
const LABEL_INDENT = 137160
export const CHART_LEFT = MARGIN + LABEL_WIDTH
export const CHART_RIGHT = SLIDE_WIDTH - MARGIN
const BAR_INSET = 54864
const DIAMOND_SIZE = 182880
const MIN_BAR_WIDTH = 45720

/** The light theme's token values (`tokens.css`), without the `#`. */
const COLOURS = {
  text: '1B2230',
  textSecondary: '4B5565',
  border: 'E2E6EC',
  accent: '2563EB',
  surface: 'FFFFFF',
  surfaceSunken: 'F0F2F5',
  warning: 'B45309'
}
/** The theme's fonts: `--font-sans`'s first Windows face. */
const FONT_FACE = 'Segoe UI'

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** Text as XML writes it: the five special characters escaped, characters XML 1.0 forbids dropped. */
export function escapeXml(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  )
}

/** A label cut to `max` characters with an ellipsis, never inside an emoji. */
export function truncateLabel(value: string, max = LABEL_MAX_CHARS): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim())
  return chars.length <= max
    ? chars.join('')
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

/** A `#rrggbb` colour as `RRGGBB`, or the accent when it is not one. */
function hex(colour: string): string {
  return /^#[0-9a-f]{6}$/i.test(colour) ? colour.slice(1).toUpperCase() : COLOURS.accent
}

/** `colour` mixed with white: a done task's paler bar. */
export function paler(colour: string, amount = 0.55): string {
  const value = hex(`#${colour}`)
  const parts = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16))
  return parts
    .map((part) =>
      Math.round(part + (255 - part) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase()
}

/** The checked range: real days, `from` not after `to`, at most `MAX_SLIDE_RANGE_DAYS`. */
export function validateSlideRange(from: string, to: string): void {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error('from and to must be YYYY-MM-DD dates')
  if (compareIsoDates(from, to) > 0) throw new Error('from must not be after to')
  if (isoDaysBetween(from, to) + 1 > MAX_SLIDE_RANGE_DAYS)
    throw new Error(`The range can be at most ${MAX_SLIDE_RANGE_DAYS} days`)
}

/**
 * The range a slide shows when none is given: from the first of the month of
 * the earliest bar (or today) to the last day of the month of the latest.
 */
export function defaultSlideRange(
  rows: readonly TimelineRow[],
  today: string
): { from: string; to: string } {
  let first = today
  let last = today
  for (const row of rows) {
    const dates =
      row.kind === 'task'
        ? row.bar
          ? [timelineBarSpan(row.bar).start, timelineBarSpan(row.bar).end]
          : []
        : row.milestone?.targetDate && isIsoDate(row.milestone.targetDate)
          ? [row.milestone.targetDate]
          : []
    for (const date of dates) {
      if (compareIsoDates(date, first) < 0) first = date
      if (compareIsoDates(date, last) > 0) last = date
    }
  }
  const from = `${first.slice(0, 7)}-01`
  const [year, month] = last.split('-').map(Number)
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return { from, to: shiftIsoDate(next, -1) }
}

// ---------------------------------------------------------------------------
// Layout: what goes where, in EMUs. Pure, and tested on its own.

export type SlideShape =
  | {
      kind: 'text'
      name: string
      x: number
      y: number
      cx: number
      cy: number
      text: string
      size: number
      bold?: boolean
      colour: string
      align?: 'l' | 'ctr'
      /** Alternative text: the full title when the label is cut. */
      descr?: string
    }
  | {
      kind: 'bar' | 'diamond'
      name: string
      x: number
      y: number
      cx: number
      cy: number
      fill: string
      descr: string
    }
  | { kind: 'line'; name: string; x: number; y: number; cy: number; colour: string; width: number }

export interface SlideLayout {
  title: string
  shapes: SlideShape[]
}

export interface TimelineSlidesLayout {
  slides: SlideLayout[]
  /** Tasks left out because they have no dates. */
  undatedCount: number
  notes: string
}

function dayX(date: string, from: string, days: number): number {
  const offset = isoDaysBetween(from, date)
  return CHART_LEFT + Math.round((offset * (CHART_RIGHT - CHART_LEFT)) / days)
}

interface Tick {
  date: string
  label: string
}

function axisTicks(from: string, to: string, zoom: TimelineSlideZoom): Tick[] {
  const ticks: Tick[] = []
  // A week axis over more than half a year would be unreadable: months then.
  const weeks = zoom === 'week' && isoDaysBetween(from, to) <= 182
  if (weeks) {
    // Weeks start on Monday, as ISO 8601 has it.
    let date = shiftIsoDate(from, -((isoWeekday(from) + 6) % 7))
    for (; compareIsoDates(date, to) <= 0; date = shiftIsoDate(date, 7))
      ticks.push({
        date: compareIsoDates(date, from) < 0 ? from : date,
        label: formatIsoDate(date, { day: 'numeric', month: 'short' })
      })
    return ticks
  }
  let date = `${from.slice(0, 7)}-01`
  while (compareIsoDates(date, to) <= 0) {
    ticks.push({
      date: compareIsoDates(date, from) < 0 ? from : date,
      label: formatIsoDate(date, { month: 'short', year: 'numeric' })
    })
    const [year, month] = date.split('-').map(Number)
    date = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  }
  return ticks
}

/** The slides' layout: titles and every shape's place, split `ROWS_PER_SLIDE` rows a slide. */
export function layoutTimelineSlides(input: TimelineSlidesInput): TimelineSlidesLayout {
  validateSlideRange(input.from, input.to)
  const { from, to, today } = input
  const days = isoDaysBetween(from, to) + 1
  const barColour = hex(input.projectColor)

  // Tasks without dates are left out (the notes count them), with the Unscheduled heading.
  const undatedCount = input.rows.filter((row) => row.kind === 'task' && !row.bar).length
  const rows = input.rows.filter((row) =>
    row.kind === 'task' ? row.bar !== null : row.key !== 'unscheduled'
  )
  const pages: TimelineRow[][] = []
  for (let at = 0; at < rows.length; at += ROWS_PER_SLIDE)
    pages.push(rows.slice(at, at + ROWS_PER_SLIDE))
  if (pages.length === 0) pages.push([])

  const ticks = axisTicks(from, to, input.zoom)
  const rangeText = t('views:timelineSlides.range', {
    from: formatIsoDate(from),
    to: formatIsoDate(to)
  })
  const baseTitle = t('views:timelineSlides.title', {
    projectName: input.projectName,
    range: rangeText
  })
  const rowsBottom = ROWS_Y + ROWS_PER_SLIDE * ROW_HEIGHT

  const slides = pages.map((page, index): SlideLayout => {
    const title =
      pages.length > 1
        ? `${baseTitle} ${t('views:timelineSlides.page', { page: index + 1, pages: pages.length })}`
        : baseTitle
    const shapes: SlideShape[] = [
      {
        kind: 'text',
        name: 'Title',
        x: MARGIN,
        y: TITLE_Y,
        cx: SLIDE_WIDTH - 2 * MARGIN,
        cy: TITLE_HEIGHT,
        text: title,
        size: 2400,
        bold: true,
        colour: COLOURS.text
      }
    ]
    // The axis, the same on every slide.
    ticks.forEach((tick, at) => {
      const x = dayX(tick.date, from, days)
      const next = at + 1 < ticks.length ? dayX(ticks[at + 1].date, from, days) : CHART_RIGHT
      shapes.push({
        kind: 'line',
        name: `Gridline ${tick.date}`,
        x,
        y: AXIS_Y,
        cy: rowsBottom - AXIS_Y,
        colour: COLOURS.border,
        width: 6350
      })
      shapes.push({
        kind: 'text',
        name: `Axis ${tick.date}`,
        x: x + 27432,
        y: AXIS_Y,
        cx: Math.max(next - x - 27432, MIN_BAR_WIDTH),
        cy: AXIS_HEIGHT,
        text: tick.label,
        size: 900,
        colour: COLOURS.textSecondary
      })
    })

    page.forEach((row, at) => {
      const y = ROWS_Y + at * ROW_HEIGHT
      if (row.kind === 'group') {
        shapes.push({
          kind: 'text',
          name: `Group ${row.label}`,
          x: MARGIN,
          y,
          cx: LABEL_WIDTH,
          cy: ROW_HEIGHT,
          text: truncateLabel(row.label),
          size: 1100,
          bold: true,
          colour: COLOURS.text,
          descr: row.label
        })
        const date = row.milestone?.targetDate
        if (
          date &&
          isIsoDate(date) &&
          compareIsoDates(date, from) >= 0 &&
          compareIsoDates(date, to) <= 0
        ) {
          const centre = Math.round(
            (dayX(date, from, days) + dayX(shiftIsoDate(date, 1), from, days)) / 2
          )
          const top = y + Math.round((ROW_HEIGHT - DIAMOND_SIZE) / 2)
          shapes.push({
            kind: 'diamond',
            name: `Milestone ${row.milestone!.name}`,
            x: centre - DIAMOND_SIZE / 2,
            y: top,
            cx: DIAMOND_SIZE,
            cy: DIAMOND_SIZE,
            fill: COLOURS.text,
            descr: t('views:timelineSlides.milestoneAlt', {
              name: row.milestone!.name,
              date: formatIsoDate(date)
            })
          })
          shapes.push({
            kind: 'text',
            name: `Milestone label ${row.milestone!.name}`,
            x: centre + DIAMOND_SIZE,
            y,
            cx: Math.max(CHART_RIGHT - centre - DIAMOND_SIZE, MIN_BAR_WIDTH),
            cy: ROW_HEIGHT,
            text: truncateLabel(row.milestone!.name),
            size: 1000,
            colour: COLOURS.text,
            descr: row.milestone!.name
          })
        }
        return
      }
      const item = row.item
      shapes.push({
        kind: 'text',
        name: `Label ${item.title}`,
        x: MARGIN + LABEL_INDENT,
        y,
        cx: LABEL_WIDTH - LABEL_INDENT,
        cy: ROW_HEIGHT,
        text: truncateLabel(item.title),
        size: 1100,
        colour: COLOURS.text,
        descr: item.title
      })
      const span = timelineBarSpan(row.bar!)
      // A bar outside the range keeps its label and draws nothing.
      if (compareIsoDates(span.end, from) < 0 || compareIsoDates(span.start, to) > 0) return
      const start = compareIsoDates(span.start, from) < 0 ? from : span.start
      const end = compareIsoDates(span.end, to) > 0 ? to : span.end
      const left = dayX(start, from, days)
      const right = dayX(shiftIsoDate(end, 1), from, days)
      shapes.push({
        kind: 'bar',
        name: `Bar ${item.title}`,
        x: left,
        y: y + BAR_INSET,
        cx: Math.max(right - left, MIN_BAR_WIDTH),
        cy: ROW_HEIGHT - 2 * BAR_INSET,
        fill: item.status === 'done' ? paler(barColour) : barColour,
        descr: item.title
      })
    })

    if (compareIsoDates(today, from) >= 0 && compareIsoDates(today, to) <= 0) {
      const x = Math.round((dayX(today, from, days) + dayX(shiftIsoDate(today, 1), from, days)) / 2)
      shapes.push({
        kind: 'line',
        name: 'Today',
        x,
        y: AXIS_Y,
        cy: rowsBottom - AXIS_Y,
        colour: COLOURS.warning,
        width: 19050
      })
      shapes.push({
        kind: 'text',
        name: 'Today label',
        x: x - 457200,
        y: AXIS_Y - AXIS_HEIGHT,
        cx: 914400,
        cy: AXIS_HEIGHT,
        text: t('views:timelineSlides.today'),
        size: 900,
        bold: true,
        colour: COLOURS.warning,
        align: 'ctr'
      })
    }
    return { title, shapes }
  })

  const notes =
    undatedCount > 0
      ? t('views:timelineSlides.undated', { count: undatedCount })
      : t('views:timelineSlides.allDated')
  return { slides, undatedCount, notes }
}

// ---------------------------------------------------------------------------
// The XML parts.

const GROUP_PROPS =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'

function nsAttrs(): string {
  return `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`
}

function run(text: string, size: number, colour: string, bold = false): string {
  return (
    `<a:r><a:rPr sz="${size}"${bold ? ' b="1"' : ''} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${colour}"/></a:solidFill><a:latin typeface="+mn-lt"/><a:cs typeface="+mn-cs"/></a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t></a:r>`
  )
}

function shapeXml(shape: SlideShape, id: number): string {
  const name = escapeXml(shape.name)
  if (shape.kind === 'line')
    return (
      `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="0" cy="${shape.cy}"/></a:xfrm>` +
      `<a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
      `<a:ln w="${shape.width}"><a:solidFill><a:srgbClr val="${shape.colour}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`
    )
  const descr = shape.descr ? ` descr="${escapeXml(shape.descr)}"` : ''
  const xfrm = `<a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="${shape.cx}" cy="${shape.cy}"/></a:xfrm>`
  if (shape.kind === 'text')
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"${descr}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
      `<a:p>${shape.align === 'ctr' ? '<a:pPr algn="ctr"/>' : ''}${run(shape.text, shape.size, shape.colour, shape.bold)}</a:p></p:txBody></p:sp>`
    )
  const geometry = shape.kind === 'bar' ? 'roundRect' : 'diamond'
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"${descr}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm}<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${shape.fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr dirty="0"/></a:p></p:txBody></p:sp>`
  )
}

function slideXml(slide: SlideLayout): string {
  const shapes = slide.shapes.map((shape, index) => shapeXml(shape, index + 2)).join('')
  return (
    `${XML_HEAD}<p:sld ${nsAttrs()}><p:cSld><p:spTree>${GROUP_PROPS}${shapes}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  )
}

function relsXml(rels: readonly { id: string; type: string; target: string }[]): string {
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_REL}">` +
    rels
      .map(
        (rel) => `<Relationship Id="${rel.id}" Type="${REL}/${rel.type}" Target="${rel.target}"/>`
      )
      .join('') +
    '</Relationships>'
  )
}

function themeXml(name: string): string {
  const scheme = (tag: string, value: string) => `<a:${tag}><a:srgbClr val="${value}"/></a:${tag}>`
  const solid = (value: string) => `<a:solidFill><a:srgbClr val="${value}"/></a:solidFill>`
  const font = `<a:latin typeface="${FONT_FACE}"/><a:ea typeface=""/><a:cs typeface=""/>`
  return (
    `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="${escapeXml(name)}"><a:themeElements>` +
    `<a:clrScheme name="${escapeXml(name)}">` +
    `<a:dk1><a:srgbClr val="${COLOURS.text}"/></a:dk1><a:lt1><a:srgbClr val="${COLOURS.surface}"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="${COLOURS.textSecondary}"/></a:dk2><a:lt2><a:srgbClr val="${COLOURS.surfaceSunken}"/></a:lt2>` +
    scheme('accent1', COLOURS.accent) +
    scheme('accent2', COLOURS.warning) +
    scheme('accent3', '15803D') +
    scheme('accent4', '7C3AED') +
    scheme('accent5', 'C81E1E') +
    scheme('accent6', '0E7490') +
    scheme('hlink', COLOURS.accent) +
    scheme('folHlink', '7C3AED') +
    '</a:clrScheme>' +
    `<a:fontScheme name="${escapeXml(name)}"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="${escapeXml(name)}">` +
    `<a:fillStyleLst>${solid(COLOURS.accent)}${solid(COLOURS.accent)}${solid(COLOURS.accent)}</a:fillStyleLst>` +
    '<a:lnStyleLst>' +
    [6350, 12700, 19050].map((w) => `<a:ln w="${w}">${solid(COLOURS.border)}</a:ln>`).join('') +
    '</a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${solid(COLOURS.surface)}${solid(COLOURS.surface)}${solid(COLOURS.surface)}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  )
}

function notesXml(text: string): string {
  return (
    `${XML_HEAD}<p:notes ${nsAttrs()}><p:cSld><p:spTree>${GROUP_PROPS}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>'
  )
}

/** Every part of the package, by path, as text. */
export function buildTimelinePptxParts(input: TimelineSlidesInput): {
  parts: Record<string, string>
  layout: TimelineSlidesLayout
} {
  const layout = layoutTimelineSlides(input)
  const slideIndexes = layout.slides.map((_, index) => index + 1)
  const blankTree = `<p:cSld><p:spTree>${GROUP_PROPS}</p:spTree></p:cSld>`

  const parts: Record<string, string> = {
    '[Content_Types].xml':
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${CT}.presentationml.notesMaster+xml"/>` +
      `<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="${CT}.presentationml.notesSlide+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}.theme+xml"/>` +
      `<Override PartName="/ppt/theme/theme2.xml" ContentType="${CT}.theme+xml"/>` +
      slideIndexes
        .map(
          (n) =>
            `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${CT}.presentationml.slide+xml"/>`
        )
        .join('') +
      '</Types>',
    '_rels/.rels': relsXml([
      { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }
    ]),
    'ppt/presentation.xml':
      `${XML_HEAD}<p:presentation ${nsAttrs()} saveSubsetFonts="1">` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' +
      `<p:sldIdLst>${slideIndexes.map((n) => `<p:sldId id="${255 + n}" r:id="rId${9 + n}"/>`).join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/>` +
      '</p:presentation>',
    'ppt/_rels/presentation.xml.rels': relsXml([
      { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
      { id: 'rId2', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' },
      { id: 'rId3', type: 'theme', target: 'theme/theme1.xml' },
      ...slideIndexes.map((n) => ({
        id: `rId${9 + n}`,
        type: 'slide',
        target: `slides/slide${n}.xml`
      }))
    ]),
    'ppt/slideMasters/slideMaster1.xml':
      `${XML_HEAD}<p:sldMaster ${nsAttrs()}><p:cSld>` +
      `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${COLOURS.surface}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
      `<p:spTree>${GROUP_PROPS}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/>` +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relsXml([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }
    ]),
    'ppt/slideLayouts/slideLayout1.xml':
      `${XML_HEAD}<p:sldLayout ${nsAttrs()} type="blank" preserve="1">` +
      blankTree.replace('<p:cSld>', '<p:cSld name="Blank">') +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml([
      { id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }
    ]),
    'ppt/notesMasters/notesMaster1.xml': `${XML_HEAD}<p:notesMaster ${nsAttrs()}>${blankTree}<p:clrMap ${CLR_MAP}/></p:notesMaster>`,
    'ppt/notesMasters/_rels/notesMaster1.xml.rels': relsXml([
      { id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }
    ]),
    'ppt/notesSlides/notesSlide1.xml': notesXml(layout.notes),
    'ppt/notesSlides/_rels/notesSlide1.xml.rels': relsXml([
      { id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
      { id: 'rId2', type: 'slide', target: '../slides/slide1.xml' }
    ]),
    'ppt/theme/theme1.xml': themeXml('Timeline'),
    'ppt/theme/theme2.xml': themeXml('Notes')
  }
  layout.slides.forEach((slide, index) => {
    const n = index + 1
    parts[`ppt/slides/slide${n}.xml`] = slideXml(slide)
    parts[`ppt/slides/_rels/slide${n}.xml.rels`] = relsXml([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      ...(n === 1
        ? [{ id: 'rId2', type: 'notesSlide', target: '../notesSlides/notesSlide1.xml' }]
        : [])
    ])
  })
  return { parts, layout }
}

/** The `.pptx` file: every part zipped, `[Content_Types].xml` first. */
export function buildTimelinePptx(input: TimelineSlidesInput): {
  bytes: Uint8Array
  slideCount: number
  undatedCount: number
} {
  const { parts, layout } = buildTimelinePptxParts(input)
  const files: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(parts)) files[path] = strToU8(text)
  return {
    bytes: zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }),
    slideCount: layout.slides.length,
    undatedCount: layout.undatedCount
  }
}
