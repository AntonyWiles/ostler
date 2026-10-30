import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  buildTimelinePptx,
  buildTimelinePptxParts,
  CHART_LEFT,
  CHART_RIGHT,
  defaultSlideRange,
  escapeXml,
  layoutTimelineSlides,
  paler,
  ROWS_PER_SLIDE,
  ROWS_Y,
  ROW_HEIGHT,
  truncateLabel,
  validateSlideRange,
  type SlideShape,
  type TimelineSlidesInput
} from '@shared/export/timeline-pptx'
import { buildTimelineRows } from '@shared/planning/timeline-rows'
import type { PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { makeWorkItem } from '../renderer/fixtures/planning-records'
import { xmlProblem } from '../helpers/well-formed-xml'

const milestone = (id: string, name: string, targetDate: string | null): PlanningMilestone =>
  ({ id, name, targetDate, status: 'active' }) as PlanningMilestone

function input(
  items: PlanningWorkItem[],
  overrides: Partial<TimelineSlidesInput> = {},
  milestones: PlanningMilestone[] = []
): TimelineSlidesInput {
  return {
    projectName: 'Launch',
    projectColor: '#3b82f6',
    rows: buildTimelineRows(items, {
      groupBy: milestones.length ? 'milestone' : 'none',
      collapsed: new Set(),
      milestones,
      people: new Map()
    }),
    // 30 days: one day is (CHART_RIGHT - CHART_LEFT) / 30 EMUs.
    from: '2026-11-01',
    to: '2026-11-30',
    zoom: 'month',
    today: '2026-11-16',
    ...overrides
  }
}

const dayX = (offset: number) => CHART_LEFT + Math.round((offset * (CHART_RIGHT - CHART_LEFT)) / 30)
const named = (shapes: SlideShape[], name: string) => shapes.find((shape) => shape.name === name)

describe('timeline slides: layout', () => {
  it('puts bars, labels and today where the dates are, in whole EMUs', () => {
    const layout = layoutTimelineSlides(
      input([
        makeWorkItem('a', {
          title: 'Book venue',
          startDate: '2026-11-02',
          targetDate: '2026-11-05'
        }),
        makeWorkItem('b', { title: 'Print', targetDate: '2026-11-10', status: 'done' })
      ])
    )
    expect(layout.slides).toHaveLength(1)
    const shapes = layout.slides[0].shapes
    const bar = named(shapes, 'Bar Book venue')!
    expect(bar).toMatchObject({ kind: 'bar', x: dayX(1), y: ROWS_Y + 54864, fill: '3B82F6' })
    expect(bar.kind === 'bar' && bar.cx).toBe(dayX(5) - dayX(1))
    const label = named(shapes, 'Label Book venue')!
    expect(label).toMatchObject({ kind: 'text', text: 'Book venue', y: ROWS_Y })
    // A due-only task is one day; a done task is paler.
    const done = named(shapes, 'Bar Print')!
    expect(done).toMatchObject({
      x: dayX(9),
      y: ROWS_Y + ROW_HEIGHT + 54864,
      fill: paler('3B82F6')
    })
    expect(paler('3B82F6')).not.toBe('3B82F6')
    const today = named(shapes, 'Today')!
    expect(today).toMatchObject({ kind: 'line', x: Math.round((dayX(15) + dayX(16)) / 2) })
    expect(named(shapes, 'Today label')).toMatchObject({ text: 'Today' })
    for (const shape of shapes) {
      for (const value of [shape.x, shape.y, 'cx' in shape ? shape.cx : 0, shape.cy])
        expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('draws a milestone as a diamond with its name, under a bold heading', () => {
    const layout = layoutTimelineSlides(
      input(
        [makeWorkItem('a', { title: 'Build', targetDate: '2026-11-20', milestoneId: 'm1' })],
        {},
        [milestone('m1', 'Beta', '2026-11-21')]
      )
    )
    const shapes = layout.slides[0].shapes
    expect(named(shapes, 'Group Beta')).toMatchObject({ kind: 'text', bold: true, y: ROWS_Y })
    const diamond = named(shapes, 'Milestone Beta')!
    expect(diamond.kind).toBe('diamond')
    const centre = Math.round((dayX(20) + dayX(21)) / 2)
    expect(diamond.x + ('cx' in diamond ? diamond.cx : 0) / 2).toBe(centre)
    expect(named(shapes, 'Milestone label Beta')).toMatchObject({ text: 'Beta' })
    expect(named(shapes, 'Bar Build')).toMatchObject({ y: ROWS_Y + ROW_HEIGHT + 54864 })
  })

  it('leaves out today outside the range and clips bars to it', () => {
    const layout = layoutTimelineSlides(
      input(
        [
          makeWorkItem('a', { title: 'Long', startDate: '2026-10-20', targetDate: '2026-11-03' }),
          makeWorkItem('b', { title: 'Later', targetDate: '2027-01-10' })
        ],
        { today: '2027-03-01' }
      )
    )
    const shapes = layout.slides[0].shapes
    expect(named(shapes, 'Today')).toBeUndefined()
    expect(named(shapes, 'Bar Long')).toMatchObject({ x: CHART_LEFT })
    expect(named(shapes, 'Bar Later')).toBeUndefined()
    expect(named(shapes, 'Label Later')).toBeDefined()
  })

  it('draws a month axis, or weeks at week zoom', () => {
    const months = layoutTimelineSlides(input([], { from: '2026-10-15', to: '2026-12-31' }))
    const axis = months.slides[0].shapes.filter((shape) => shape.name.startsWith('Axis '))
    expect(axis.map((shape) => shape.name)).toEqual([
      'Axis 2026-10-15',
      'Axis 2026-11-01',
      'Axis 2026-12-01'
    ])
    const weeks = layoutTimelineSlides(input([], { zoom: 'week' }))
    const ticks = weeks.slides[0].shapes.filter((shape) => shape.name.startsWith('Axis '))
    // 1 Nov 2026 is a Sunday: the week before starts the axis at the range, then Mondays.
    expect(ticks.map((shape) => shape.name)).toEqual([
      'Axis 2026-11-01',
      'Axis 2026-11-02',
      'Axis 2026-11-09',
      'Axis 2026-11-16',
      'Axis 2026-11-23',
      'Axis 2026-11-30'
    ])
  })

  it('splits rows across slides with the axis repeated and (n of m) in the title', () => {
    const items = Array.from({ length: 40 }, (_, at) =>
      makeWorkItem(`t${at}`, {
        title: `Task ${String(at).padStart(2, '0')}`,
        targetDate: '2026-11-10'
      })
    )
    const layout = layoutTimelineSlides(input(items))
    expect(layout.slides).toHaveLength(3)
    expect(layout.slides[0].title).toContain('(1 of 3)')
    expect(layout.slides[2].title).toContain('(3 of 3)')
    const bars = layout.slides.map((slide) => slide.shapes.filter((s) => s.kind === 'bar').length)
    expect(bars).toEqual([ROWS_PER_SLIDE, ROWS_PER_SLIDE, 40 - 2 * ROWS_PER_SLIDE])
    const axisNames = (index: number) =>
      layout.slides[index].shapes.filter((s) => s.name.startsWith('Axis ')).map((s) => s.name)
    expect(axisNames(1)).toEqual(axisNames(0))
    expect(axisNames(2)).toEqual(axisNames(0))
    expect(layout.slides[1].shapes.find((s) => s.name === 'Label Task 18')).toMatchObject({
      y: ROWS_Y
    })
  })

  it('leaves undated tasks out and counts them in the notes', () => {
    const layout = layoutTimelineSlides(
      input([
        makeWorkItem('a', { title: 'Dated', targetDate: '2026-11-03' }),
        makeWorkItem('b', { title: 'Someday one' }),
        makeWorkItem('c', { title: 'Someday two' })
      ])
    )
    expect(layout.undatedCount).toBe(2)
    expect(layout.notes).toBe('2 tasks have no dates and are not on these slides.')
    const names = layout.slides[0].shapes.map((shape) => shape.name)
    expect(names.some((name) => name.includes('Someday'))).toBe(false)
    expect(names.some((name) => name.includes('Unscheduled'))).toBe(false)
  })

  it('cuts long titles with an ellipsis and keeps the full title as alt text', () => {
    const long = 'A very long task title that will not fit in the label column at all'
    const layout = layoutTimelineSlides(
      input([makeWorkItem('a', { title: long, targetDate: '2026-11-03' })])
    )
    const label = layout.slides[0].shapes.find((shape) => shape.name === `Label ${long}`)!
    expect(label.kind === 'text' && label.text.endsWith('…')).toBe(true)
    expect(label.kind === 'text' && Array.from(label.text).length).toBeLessThanOrEqual(34)
    expect(label.kind === 'text' && label.descr).toBe(long)
    expect(truncateLabel('🚀'.repeat(40), 5)).toBe('🚀🚀🚀🚀…')
  })

  it('refuses a bad range and picks whole months by default', () => {
    expect(() => validateSlideRange('2026-11-30', '2026-11-01')).toThrow()
    expect(() => validateSlideRange('2026-11-01', 'soon')).toThrow()
    expect(() => validateSlideRange('2026-01-01', '2030-01-01')).toThrow()
    const rows = input([
      makeWorkItem('a', { startDate: '2026-11-12', targetDate: '2027-01-03' })
    ]).rows
    expect(defaultSlideRange(rows, '2026-11-20')).toEqual({ from: '2026-11-01', to: '2027-01-31' })
  })
})

describe('timeline slides: the package', () => {
  const tricky = 'R&D <beta> "quoted" \'single\' 🚀 done'

  it('has every part and relationship, each well-formed XML', () => {
    const { parts } = buildTimelinePptxParts(
      input(
        [
          makeWorkItem('a', { title: tricky, targetDate: '2026-11-03', milestoneId: 'm1' }),
          makeWorkItem('b', { title: 'No dates' })
        ],
        { projectName: 'Tom & Jerry <Co>' },
        [milestone('m1', 'M & <1>', '2026-11-05')]
      )
    )
    for (const path of [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      'ppt/theme/theme1.xml',
      'ppt/theme/theme2.xml',
      'ppt/notesMasters/notesMaster1.xml',
      'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels'
    ])
      expect(parts[path], path).toBeDefined()
    for (const [path, xml] of Object.entries(parts)) expect(xmlProblem(xml), path).toBeNull()

    // Every relationship points at a part that exists, and every part but the rels has a content type.
    for (const [path, xml] of Object.entries(parts).filter(([p]) => p.endsWith('.rels'))) {
      const base = path.replace(/_rels\/[^/]*\.rels$/, '')
      for (const [, target] of xml.matchAll(/Target="([^"]+)"/g)) {
        const segments = `${base}${target}`.split('/')
        const resolved: string[] = []
        for (const segment of segments)
          if (segment === '..') resolved.pop()
          else if (segment) resolved.push(segment)
        expect(parts[resolved.join('/')], `${path} -> ${target}`).toBeDefined()
      }
    }
    const types = parts['[Content_Types].xml']
    for (const path of Object.keys(parts).filter(
      (p) => !p.endsWith('.rels') && p.startsWith('ppt/')
    ))
      expect(types, path).toContain(`PartName="/${path}"`)
    expect(parts['ppt/presentation.xml']).toContain('<p:sldSz cx="12192000" cy="6858000"/>')

    const slide = parts['ppt/slides/slide1.xml']
    expect(slide).toContain(escapeXml(tricky))
    expect(slide).toContain('R&amp;D &lt;beta&gt; &quot;quoted&quot; &apos;single&apos; 🚀 done')
    expect(slide).toContain('Tom &amp; Jerry &lt;Co&gt;')
    expect(slide).toContain('prst="roundRect"')
    expect(slide).toContain('prst="diamond"')
    expect(slide).toContain('prst="line"')
    expect(slide).not.toContain('No dates')
    expect(parts['ppt/notesSlides/notesSlide1.xml']).toContain('1 task has no dates')
  })

  it('zips to a file whose parts come back the same, with a slide per page', () => {
    const items = Array.from({ length: 20 }, (_, at) =>
      makeWorkItem(`t${at}`, { title: `Task ${at}`, targetDate: '2026-11-10' })
    )
    const built = buildTimelinePptx(input(items))
    expect(built.slideCount).toBe(2)
    const files = unzipSync(built.bytes)
    expect(Object.keys(files)).toContain('[Content_Types].xml')
    expect(Object.keys(files)).toContain('ppt/slides/slide2.xml')
    for (const [path, bytes] of Object.entries(files))
      expect(xmlProblem(strFromU8(bytes)), path).toBeNull()
  })

  it('escapes XML and drops characters XML cannot hold', () => {
    expect(escapeXml('a&b<c>"d\'e')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;e')
    expect(escapeXml('bell\u0007 tab\t')).toBe('bell tab\t')
    expect(escapeXml('🚀')).toBe('🚀')
    expect(xmlProblem('<a>&</a>')).not.toBeNull()
  })
})
