import { describe, expect, it } from 'vitest'
import {
  LINK_GAP,
  lagLabel,
  linkEnds,
  linkRoute,
  linkTypeForEnds
} from '../../src/renderer/ui/timeline-links'
import { timelineLinkWords } from '../../src/renderer/views/planning/dependency-link-words'

/** The numbers in a path, as [x, y] points for M/H/V commands. */
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const parts = d.split(' ')
  let x = 0
  let y = 0
  for (let at = 0; at < parts.length; at += 1) {
    const command = parts[at]
    if (command === 'M') {
      x = Number(parts[++at])
      y = Number(parts[++at])
    } else if (command === 'H') x = Number(parts[++at])
    else if (command === 'V') y = Number(parts[++at])
    else continue
    out.push([x, y])
  }
  return out
}

const ROW = 36
const a = { left: 100, right: 200, y: 18 }
const b = { left: 260, right: 320, y: 54 }

describe('Timeline link geometry (N7.2b)', () => {
  it('joins the ends each type names', () => {
    expect(linkEnds('finish-to-start')).toEqual({ from: 'end', to: 'start' })
    expect(linkEnds('start-to-start')).toEqual({ from: 'start', to: 'start' })
    expect(linkEnds('finish-to-finish')).toEqual({ from: 'end', to: 'end' })
  })

  it('draws finish to start from the end of one bar to the start of the other', () => {
    const route = points(linkRoute(a, b, 'finish-to-start', ROW).d)
    expect(route[0]).toEqual([a.right, a.y])
    expect(route[route.length - 1]).toEqual([b.left, b.y])
  })

  it('draws start to start from start to start, turning left of both bars', () => {
    const route = points(linkRoute(a, b, 'start-to-start', ROW).d)
    expect(route[0]).toEqual([a.left, a.y])
    expect(route[route.length - 1]).toEqual([b.left, b.y])
    expect(route[1][0]).toBe(Math.min(a.left, b.left) - LINK_GAP)
  })

  it('draws finish to finish from end to end, turning right of both bars', () => {
    const route = points(linkRoute(a, b, 'finish-to-finish', ROW).d)
    expect(route[0]).toEqual([a.right, a.y])
    expect(route[route.length - 1]).toEqual([b.right, b.y])
    expect(route[1][0]).toBe(Math.max(a.right, b.right) + LINK_GAP)
  })

  it('routes an overlapping finish-to-start link along the row line, not over the bars', () => {
    const late = { left: 150, right: 300, y: 54 }
    const route = points(linkRoute(a, late, 'finish-to-start', ROW).d)
    expect(route[0]).toEqual([a.right, a.y])
    expect(route[route.length - 1]).toEqual([late.left, late.y])
    // Every horizontal run is at a row's middle only beyond the bars, or on the row line.
    const line = a.y + ROW / 2
    expect(route.some(([, y]) => y === line)).toBe(true)
    for (let at = 1; at < route.length; at += 1) {
      const [x1, y1] = route[at - 1]
      const [x2, y2] = route[at]
      if (y1 !== y2) continue
      const [low, high] = [Math.min(x1, x2), Math.max(x1, x2)]
      if (y1 === a.y) expect(low >= a.right || high <= a.left).toBe(true)
      if (y1 === late.y) expect(low >= late.right || high <= late.left).toBe(true)
    }
  })

  it('puts the lag label beside the upright run', () => {
    const route = linkRoute(a, b, 'start-to-start', ROW)
    expect(route.labelX).toBe(a.left - LINK_GAP)
    expect(route.labelY).toBe((a.y + b.y) / 2)
  })

  it('labels a lag, and none for 0', () => {
    expect(lagLabel(2)).toBe('+2d')
    expect(lagLabel(-1)).toBe('−1d')
    expect(lagLabel(0)).toBeNull()
    expect(lagLabel(undefined)).toBeNull()
  })

  it('takes the type from the ends drawn between, and refuses start to end', () => {
    expect(linkTypeForEnds('end', 'start')).toBe('finish-to-start')
    expect(linkTypeForEnds('start', 'start')).toBe('start-to-start')
    expect(linkTypeForEnds('end', 'end')).toBe('finish-to-finish')
    expect(linkTypeForEnds('start', 'end')).toBeNull()
  })

  it('says each type in words, naming both tasks', () => {
    const words = (type: Parameters<typeof timelineLinkWords>[0]['type'], lagDays: number) =>
      timelineLinkWords({ type, lagDays }, 'Painting', 'Plastering')
    expect(words('start-to-start', 2)).toBe('Painting starts 2 days after Plastering starts')
    expect(words('start-to-start', 0)).toBe('Painting starts when Plastering starts')
    expect(words('finish-to-start', 1)).toBe('Painting starts 1 day after Plastering is due')
    expect(words('finish-to-start', -3)).toBe('Painting starts 3 days before Plastering is due')
    expect(words('finish-to-finish', 0)).toBe('Painting is due when Plastering is due')
    expect(words('finish-to-finish', -1)).toBe('Painting is due 1 day before Plastering is due')
  })
})
