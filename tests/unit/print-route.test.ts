import { describe, expect, it } from 'vitest'
import {
  myWeekHashPath,
  parseMyWeekHash,
  parsePrintHash,
  parseRoundsHash,
  parseTimeReportHash,
  parseTimelineOverviewHash,
  parseWhiteboardHash,
  parseYearInReviewHash,
  printHashPath,
  roundsHashPath,
  timeReportHashPath,
  whiteboardHashPath
} from '../../src/shared/print-route'

describe('the my-week print route', () => {
  it('round trips the local date', () => {
    expect(myWeekHashPath('2026-10-15')).toBe('/print/my-week?today=2026-10-15')
    expect(parseMyWeekHash(myWeekHashPath('2026-10-15'))).toEqual({ today: '2026-10-15' })
  })

  it('refuses anything else', () => {
    expect(() => myWeekHashPath('15/10/2026')).toThrow()
    expect(() => myWeekHashPath(undefined as unknown as string)).toThrow()
    expect(parseMyWeekHash('/print/my-week')).toBeNull()
    expect(parseMyWeekHash('/print/my-week?today=2026-02-31')).toBeNull()
    expect(parseMyWeekHash('/print/my-week?today=2026-10-15&x=1')).toBeNull()
    expect(parseMyWeekHash('/print/p1/list')).toBeNull()
    expect(parseMyWeekHash('/projects/p1/list')).toBeNull()
    expect(parsePrintHash(myWeekHashPath('2026-10-15'))).toBeNull()
  })

  it('leaves a project route as it was', () => {
    expect(parsePrintHash(printHashPath('my-week', { view: 'list' }))).toEqual({
      projectId: 'my-week',
      view: 'list',
      config: null
    })
    expect(parseMyWeekHash(printHashPath('p1', { view: 'timeline' }))).toBeNull()
  })
})

describe('the whiteboard print route', () => {
  it('round trips ids that need encoding', () => {
    const route = { projectId: 'project/one?', whiteboardId: 'board #2 ü' }
    const hash = whiteboardHashPath(route)
    expect(hash).toBe('/print/whiteboard/project%2Fone%3F/board%20%232%20%C3%BC')
    expect(parseWhiteboardHash(hash)).toEqual(route)
  })

  it('does not read other print routes as a whiteboard', () => {
    expect(parseWhiteboardHash(printHashPath('p1', { view: 'list' }))).toBeNull()
    expect(parseWhiteboardHash(myWeekHashPath('2026-10-15'))).toBeNull()
    expect(
      parseWhiteboardHash(roundsHashPath({ projectId: 'p1', milestoneId: 'm1', measure: 'cycle' }))
    ).toBeNull()
    expect(
      parseWhiteboardHash(
        timeReportHashPath({ projectId: 'p1', from: '2026-10-01', to: '2026-10-31' })
      )
    ).toBeNull()
    expect(parseWhiteboardHash('/print/whiteboard/p1')).toBeNull()
    expect(parseWhiteboardHash('/print/whiteboard/p1/w1/extra')).toBeNull()
    expect(parseWhiteboardHash('/print/whiteboard/p1/w1?x=1')).toBeNull()
    expect(parseWhiteboardHash('/print/whiteboard/%E0%A4%A/w1')).toBeNull()
  })

  it('is read by no other print route', () => {
    const hash = whiteboardHashPath({ projectId: 'p1', whiteboardId: 'w1' })
    expect(parsePrintHash(hash)).toBeNull()
    expect(parseRoundsHash(hash)).toBeNull()
    expect(parseMyWeekHash(hash)).toBeNull()
    expect(parseTimelineOverviewHash(hash)).toBeNull()
    expect(parseTimeReportHash(hash)).toBeNull()
    expect(parseYearInReviewHash(hash)).toBeNull()
  })
})
